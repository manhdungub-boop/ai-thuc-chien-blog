import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";

const task = (id, query = "research open models") => ({
  id,
  task_type: "ai_bank_discovery",
  payload: { query }
});

function storeFor(name = "agent-runtime-tests") {
  return env.AGENT_TASK_STORE.getByName(name);
}

describe("AgentTaskStore Durable Object", () => {
  let store;

  beforeEach(() => {
    store = storeFor();
  });

  it("accepts valid tasks and rejects unsupported types or payload fields", async () => {
    const accepted = await store.enqueue(task("task-valid-0001"));
    expect(accepted.accepted).toBe(true);
    expect(accepted.task.status).toBe("pending");

    await expect(store.enqueue({
      id: "task-invalid-0001",
      task_type: "shell_exec",
      payload: { command: "whoami" }
    })).rejects.toThrow("task_type_not_allowed");

    await expect(store.enqueue({
      id: "task-invalid-0002",
      task_type: "ai_bank_discovery",
      payload: { query: "valid query", url: "https://example.com" }
    })).rejects.toThrow("invalid_payload");
  });

  it("treats identical idempotency requests as duplicates and rejects conflicts", async () => {
    const first = await store.enqueue(task("task-idempotent-01"));
    const duplicate = await store.enqueue(task("task-idempotent-01"));
    const conflict = await store.enqueue(task("task-idempotent-01", "different request"));

    expect(first.accepted).toBe(true);
    expect(duplicate).toMatchObject({ accepted: true, duplicate: true });
    expect(conflict).toEqual({ accepted: false, reason: "idempotency_key_conflict" });
    expect(await store.stats()).toEqual({ pending: 1 });
  });

  it("allows only one winner when concurrent workers claim a single task", async () => {
    await store.enqueue(task("task-concurrent-01"));
    const claims = await Promise.all([store.claim(), store.claim()]);
    const winners = claims.filter(result => result.task !== null);

    expect(winners).toHaveLength(1);
    expect(winners[0].lease_token).toEqual(expect.any(String));
    expect(winners[0].task.status).toBe("leased");
  });

  it("fences stale leases after expiry and re-claim", async () => {
    await store.enqueue(task("task-fencing-0001"));
    const oldClaim = await store.claim();

    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE tasks SET lease_until = ? WHERE id = ?",
        Date.now() - 1,
        "task-fencing-0001"
      );
    });

    const newClaim = await store.claim();
    expect(newClaim.task.id).toBe("task-fencing-0001");
    expect(newClaim.lease_token).not.toBe(oldClaim.lease_token);
    expect(await store.complete("task-fencing-0001", oldClaim.lease_token)).toEqual({ updated: false });
    expect(await store.retry("task-fencing-0001", oldClaim.lease_token, "stale_worker")).toEqual({ updated: false });
    expect(await store.complete("task-fencing-0001", newClaim.lease_token)).toEqual({ updated: true });
    expect(await store.stats()).toEqual({ completed: 1 });
  });

  it("moves a task to dead-letter after the fifth failed attempt", async () => {
    await store.enqueue(task("task-dead-letter-01"));

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claim = await store.claim();
      expect(claim.task.attempts).toBe(attempt);
      const result = await store.retry("task-dead-letter-01", claim.lease_token, "simulated_failure");
      expect(result.updated).toBe(true);
      expect(result.status).toBe(attempt === 5 ? "dead" : "pending");
    }

    expect(await store.claim()).toEqual({ task: null });
    expect(await store.stats()).toEqual({ dead: 1 });
  });

  it("enforces the active queue capacity without accepting the 501st task", async () => {
    for (let index = 0; index < 500; index += 1) {
      const result = await store.enqueue(task(`task-capacity-${String(index).padStart(4, "0")}`));
      expect(result.accepted).toBe(true);
    }

    const overflow = await store.enqueue(task("task-capacity-overflow"));
    expect(overflow).toEqual({ accepted: false, reason: "queue_capacity_reached" });
    expect(await store.stats()).toEqual({ pending: 500 });
  });
});
