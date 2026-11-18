import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";

const task = (id, query = "research open models") => ({
  id,
  task_type: "ai_bank_discovery",
  payload: { query }
});

function storeFor(name) {
  return env.AGENT_TASK_STORE.getByName(name);
}

describe("AgentTaskStore Durable Object", () => {
  let store;
  let testIndex = 0;

  beforeEach(() => {
    // Give each test a fresh Durable Object so persistent SQLite rows from
    // one test cannot contaminate the next test's assertions.
    testIndex += 1;
    store = storeFor(`agent-runtime-tests-${testIndex}`);
  });

  it("accepts valid tasks and rejects unsupported types or payload fields", async () => {
    const accepted = await store.enqueue(task("task-valid-0001"));
    expect(accepted.accepted).toBe(true);
    expect(accepted.task.status).toBe("pending");

    await expect(Promise.resolve().then(() => store.enqueue({
      id: "task-invalid-0001",
      task_type: "shell_exec",
      payload: { command: "whoami" }
    }))).rejects.toThrow("task_type_not_allowed");

    await expect(Promise.resolve().then(() => store.enqueue({
      id: "task-invalid-0002",
      task_type: "ai_bank_discovery",
      payload: { query: "valid query", url: "https://example.com" }
    }))).rejects.toThrow("invalid_payload");
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

  it("executes and persists only allowlisted local health-check results", async () => {
    const request = { id: "runtime-health-test-01", task_type: "runtime_health_check", payload: {} };
    await store.enqueue(request);
    const noMatch = await store.claim(["quality_review"]);
    expect(noMatch).toEqual({ task: null });
    const claim = await store.claim(["runtime_health_check"], request.id);
    expect(claim.task.task_type).toBe("runtime_health_check");
    const result = { healthy: true, external_calls: 0, production_access: false };
    expect(await store.complete(request.id, claim.lease_token, result)).toEqual({ updated: true });
    const duplicate = await store.enqueue(request);
    expect(duplicate.task.status).toBe("completed");
    expect(duplicate.task.result).toEqual(result);
    expect(await store.stats()).toEqual({ completed: 1 });
  });
  it("enforces persistent daily outbound budgets independently for each discovery scope", async () => {
    const day = "2026-11-18";
    for (let index = 0; index < 10; index += 1) {
      const result = await store.consumeExternalRequestBudget(day, "ai_bank_discovery");
      expect(result).toMatchObject({ allowed: true, used: index + 1, limit: 10 });
    }
    expect(await store.consumeExternalRequestBudget(day, "ai_bank_discovery")).toMatchObject({
      allowed: false,
      used: 10,
      limit: 10,
      remaining: 0,
      reason: "daily_external_request_budget_exhausted"
    });

    for (let index = 0; index < 8; index += 1) {
      const result = await store.consumeExternalRequestBudget(day, "content_research");
      expect(result).toMatchObject({ allowed: true, used: index + 1, limit: 8 });
    }
    expect(await store.consumeExternalRequestBudget(day, "content_research")).toMatchObject({
      allowed: false,
      used: 8,
      limit: 8,
      remaining: 0
    });
  });

  it("atomically enforces the daily budget under concurrent outbound attempts", async () => {
    const day = "2026-11-18";
    const results = await Promise.all(
      Array.from({ length: 16 }, () => store.consumeExternalRequestBudget(day, "ai_bank_discovery"))
    );
    expect(results.filter(result => result.allowed)).toHaveLength(10);
    expect(results.filter(result => !result.allowed)).toHaveLength(6);
    expect(results.filter(result => result.allowed).map(result => result.used).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("rejects invalid budget dates and scopes without consuming quota", async () => {
    await expect(Promise.resolve().then(() =>
      store.consumeExternalRequestBudget("2026-02-30", "ai_bank_discovery")
    )).rejects.toThrow("invalid_external_request_budget");
    await expect(Promise.resolve().then(() =>
      store.consumeExternalRequestBudget("2026-11-18", "untrusted_scope")
    )).rejects.toThrow("invalid_external_request_budget");
    expect(await store.consumeExternalRequestBudget("2026-11-18", "ai_bank_discovery"))
      .toMatchObject({ allowed: true, used: 1, limit: 10 });
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
