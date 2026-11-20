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

    const draftTask = await store.enqueue({
      id: "task-content-draft-01",
      task_type: "content_draft",
      payload: { topic: "AI automation", research_task_id: "research-task-01" }
    });
    expect(draftTask.accepted).toBe(true);
    expect(draftTask.task.status).toBe("pending");

    await expect(Promise.resolve().then(() => store.enqueue({
      id: "task-unimplemented-02",
      task_type: "quality_review",
      payload: { artifact_id: "article-0001", artifact_type: "article" }
    }))).rejects.toThrow("task_type_not_allowed");
  });

  it("never leases legacy pending rows without a registered executor", async () => {
    const now = Date.now();
    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO tasks (id, task_type, payload_json, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)",
        "legacy-content-draft",
        "content_draft",
        JSON.stringify({ topic: "AI automation", research_task_id: "research-task-01" }),
        now,
        now
      );
      state.storage.sql.exec(
        "INSERT INTO tasks (id, task_type, payload_json, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)",
        "legacy-quality-review",
        "quality_review",
        JSON.stringify({ artifact_id: "article-0001", artifact_type: "article" }),
        now,
        now
      );
    });

    const draftClaim = await store.claim(["content_draft"]);
    expect(draftClaim.task.id).toBe("legacy-content-draft");
    expect(await store.complete("legacy-content-draft", draftClaim.lease_token, {
      status: "human_authoring_required",
      publication_authorized: false
    })).toEqual({ updated: true });
    await expect(Promise.resolve().then(() => store.claim(["quality_review"])))
      .rejects.toThrow("invalid_claim_task_types");
    expect(await store.stats()).toEqual({ completed: 1, pending: 1 });
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
        "UPDATE tasks SET lease_until = ?, available_at = ? WHERE id = ?",
        Date.now() - 1,
        Date.now() - 1,
        "task-fencing-0001"
      );
    });

    expect(await store.claim()).toEqual({ task: null });
    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec("UPDATE tasks SET available_at = 0 WHERE id = ?", "task-fencing-0001");
    });
    const newClaim = await store.claim();
    expect(newClaim.task.id).toBe("task-fencing-0001");
    expect(newClaim.lease_token).not.toBe(oldClaim.lease_token);
    expect(await store.complete("task-fencing-0001", oldClaim.lease_token)).toEqual({ updated: false });
    expect(await store.retry("task-fencing-0001", oldClaim.lease_token, "stale_worker")).toEqual({ updated: false });
    expect(await store.complete("task-fencing-0001", newClaim.lease_token)).toEqual({ updated: true });
    expect(await store.stats()).toEqual({ completed: 1 });
  });

  it("rejects invalid claim input before mutating expired leases", async () => {
    const now = Date.now();
    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO tasks (id, task_type, payload_json, status, attempts, created_at, updated_at, lease_until, lease_token) VALUES (?, ?, ?, 'leased', 1, ?, ?, ?, ?)",
        "task-invalid-claim-01",
        "ai_bank_discovery",
        JSON.stringify({ query: "research open models" }),
        now - 10_000,
        now - 10_000,
        now - 1,
        "expired-lease-token"
      );
    });

    await expect(Promise.resolve().then(() => store.claim(["quality_review"])))
      .rejects.toThrow("invalid_claim_task_types");
    expect(await store.stats()).toEqual({ leased: 1 });

    expect(await store.claim(["ai_bank_discovery"], "task-invalid-claim-01"))
      .toEqual({ task: null });
    const delayed = await runInDurableObject(store, async (_instance, state) =>
      state.storage.sql.exec("SELECT available_at FROM tasks WHERE id = ?", "task-invalid-claim-01").one().available_at
    );
    expect(delayed).toBeGreaterThan(Date.now());
    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec("UPDATE tasks SET available_at = 0 WHERE id = ?", "task-invalid-claim-01");
    });
    const recovered = await store.claim(["ai_bank_discovery"], "task-invalid-claim-01");
    expect(recovered.task.status).toBe("leased");
    expect(recovered.task.attempts).toBe(2);
    expect(recovered.lease_token).not.toBe("expired-lease-token");
  });

  it("recovers an expired fifth-attempt lease into dead-letter without allowing stale completion", async () => {
    await store.enqueue(task("task-expired-fifth-01"));
    const claim = await store.claim([ "ai_bank_discovery" ], "task-expired-fifth-01");
    expect(claim.task.attempts).toBe(1);

    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE tasks SET attempts = 5, lease_until = ?, updated_at = ? WHERE id = ?",
        Date.now() - 1,
        Date.now() - 1,
        "task-expired-fifth-01"
      );
    });

    expect(await store.claim([ "ai_bank_discovery" ], "task-expired-fifth-01"))
      .toEqual({ task: null });
    expect(await store.complete("task-expired-fifth-01", claim.lease_token, { ok: true }))
      .toEqual({ updated: false });
    expect(await store.retry("task-expired-fifth-01", claim.lease_token, "stale_retry"))
      .toEqual({ updated: false });
    expect(await store.stats()).toEqual({ dead: 1 });
  });

  it("applies bounded exponential backoff after retryable failures", async () => {
    await store.enqueue(task("task-backoff-0001"));
    const first = await store.claim(["ai_bank_discovery"], "task-backoff-0001");
    const firstRetry = await store.retry("task-backoff-0001", first.lease_token, "temporary_source_error");
    expect(firstRetry).toEqual({ updated: true, status: "pending" });
    const firstAvailableAt = await runInDurableObject(store, async (_instance, state) =>
      state.storage.sql.exec("SELECT available_at FROM tasks WHERE id = ?", "task-backoff-0001").one().available_at
    );
    expect(firstAvailableAt - Date.now()).toBeGreaterThan(29_000);
    expect(firstAvailableAt - Date.now()).toBeLessThanOrEqual(30_000);
    expect(await store.claim(["ai_bank_discovery"], "task-backoff-0001")).toEqual({ task: null });

    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec("UPDATE tasks SET available_at = 0 WHERE id = ?", "task-backoff-0001");
    });
    const second = await store.claim(["ai_bank_discovery"], "task-backoff-0001");
    expect(second.task.attempts).toBe(2);
    await store.retry("task-backoff-0001", second.lease_token, "temporary_source_error");
    const secondAvailableAt = await runInDurableObject(store, async (_instance, state) =>
      state.storage.sql.exec("SELECT available_at FROM tasks WHERE id = ?", "task-backoff-0001").one().available_at
    );
    expect(secondAvailableAt - Date.now()).toBeGreaterThan(119_000);
    expect(secondAvailableAt - Date.now()).toBeLessThanOrEqual(120_000);
  });

  it("moves a task to dead-letter after the fifth failed attempt", async () => {
    await store.enqueue(task("task-dead-letter-01"));

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claim = await store.claim();
      expect(claim.task.attempts).toBe(attempt);
      const result = await store.retry("task-dead-letter-01", claim.lease_token, "simulated_failure");
      expect(result.updated).toBe(true);
      expect(result.status).toBe(attempt === 5 ? "dead" : "pending");
      if (attempt < 5) {
        await runInDurableObject(store, async (_instance, state) => {
          state.storage.sql.exec("UPDATE tasks SET available_at = 0 WHERE id = ?", "task-dead-letter-01");
        });
      }
    }

    expect(await store.claim()).toEqual({ task: null });
    expect(await store.stats()).toEqual({ dead: 1 });
  });

  it("executes and persists only allowlisted local health-check results", async () => {
    const request = { id: "runtime-health-test-01", task_type: "runtime_health_check", payload: {} };
    await store.enqueue(request);
    await expect(Promise.resolve().then(() => store.claim(["quality_review"])))
      .rejects.toThrow("invalid_claim_task_types");
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

  it("reads daily budget usage without consuming or mutating quota", async () => {
    const day = "2026-11-18";
    expect(await store.getExternalRequestBudget(day, "ai_bank_discovery")).toEqual({
      day, scope: "ai_bank_discovery", used: 0, limit: 10, remaining: 10
    });
    await store.consumeExternalRequestBudget(day, "ai_bank_discovery");
    await store.consumeExternalRequestBudget(day, "ai_bank_discovery");
    expect(await store.getExternalRequestBudget(day, "ai_bank_discovery")).toEqual({
      day, scope: "ai_bank_discovery", used: 2, limit: 10, remaining: 8
    });
    expect(await store.getExternalRequestBudget(day, "content_research")).toEqual({
      day, scope: "content_research", used: 0, limit: 8, remaining: 8
    });
    expect(await store.getExternalRequestBudget(day, "ai_bank_discovery")).toMatchObject({
      used: 2, remaining: 8
    });
  });

  it("rejects invalid dates and unknown scopes in read-only budget snapshots", async () => {
    await expect(Promise.resolve().then(() =>
      store.getExternalRequestBudget("2026-02-30", "ai_bank_discovery")
    )).rejects.toThrow("invalid_external_request_budget");
    await expect(Promise.resolve().then(() =>
      store.getExternalRequestBudget("2026-11-18", "other_scope")
    )).rejects.toThrow("invalid_external_request_budget");
    expect(await store.getExternalRequestBudget("2026-11-18", "ai_bank_discovery"))
      .toMatchObject({ used: 0, remaining: 10 });
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

  it("moves a daily budget-exhausted task to dead-letter immediately without burning retry attempts", async () => {
    await store.enqueue(task("budget-exhausted-task-01"));
    const claim = await store.claim(["ai_bank_discovery"], "budget-exhausted-task-01");
    expect(claim.task.attempts).toBe(1);

    const result = await store.abandon(
      "budget-exhausted-task-01",
      claim.lease_token,
      "daily_external_request_budget_exhausted"
    );
    expect(result).toEqual({ updated: true, status: "dead" });

    const duplicate = await store.enqueue(task("budget-exhausted-task-01"));
    expect(duplicate.task.status).toBe("dead");
    expect(duplicate.task.attempts).toBe(1);
    expect(duplicate.task.last_error).toBe("daily_external_request_budget_exhausted");
    expect(await store.claim(["ai_bank_discovery"], "budget-exhausted-task-01"))
      .toEqual({ task: null });

    expect(await store.abandon(
      "budget-exhausted-task-01",
      claim.lease_token,
      "stale_attempt"
    )).toEqual({ updated: false });
  });

  it("rejects invalid retention timestamps and unbounded cleanup limits", async () => {
    for (const [now, limit] of [
      [-1, 100],
      [Number.MAX_SAFE_INTEGER, 100],
      [Date.now(), 0],
      [Date.now(), 101],
      [Date.now(), 1.5]
    ]) {
      await expect(Promise.resolve().then(() => store.pruneTerminalTasks(now, limit)))
        .rejects.toThrow("invalid_retention_options");
    }
    expect(await store.stats()).toEqual({});
  });

  it("leaves expired budget rows for the bounded retention pass", async () => {
    const now = Date.parse("2026-11-18T12:00:00.000Z");
    const day = "2026-11-18";
    await runInDurableObject(store, async (_instance, state) => {
      for (let index = 0; index < 105; index += 1) {
        const budgetDay = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
        state.storage.sql.exec(
          "INSERT INTO external_request_budgets (budget_day, scope, used, updated_at) VALUES (?, ?, ?, ?)",
          budgetDay,
          "ai_bank_discovery",
          1,
          now
        );
      }
    });

    expect(await store.consumeExternalRequestBudget(day, "ai_bank_discovery"))
      .toMatchObject({ allowed: true, used: 1, limit: 10 });
    const beforePrune = await runInDurableObject(store, async (_instance, state) =>
      state.storage.sql.exec("SELECT COUNT(*) AS count FROM external_request_budgets").one().count
    );
    expect(beforePrune).toBe(106);

    const result = await store.pruneTerminalTasks(now);
    expect(result.budget_days_deleted).toBe(100);
    const afterPrune = await runInDurableObject(store, async (_instance, state) =>
      state.storage.sql.exec("SELECT COUNT(*) AS count FROM external_request_budgets").one().count
    );
    expect(afterPrune).toBe(6);
  });

  it("prunes only completed tasks older than one day and dead tasks older than seven days", async () => {
    const now = Date.parse("2026-11-18T12:00:00.000Z");
    await store.enqueue(task("retention-completed-old"));
    const completedClaim = await store.claim(["ai_bank_discovery"], "retention-completed-old");
    await store.complete("retention-completed-old", completedClaim.lease_token, { ok: true });

    await store.enqueue(task("retention-dead-old"));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claim = await store.claim(["ai_bank_discovery"], "retention-dead-old");
      await store.retry("retention-dead-old", claim.lease_token, "test_failure");
      if (attempt < 4) {
        await runInDurableObject(store, async (_instance, state) => {
          state.storage.sql.exec("UPDATE tasks SET available_at = 0 WHERE id = ?", "retention-dead-old");
        });
      }
    }

    await store.enqueue(task("retention-pending-old"));
    await store.enqueue(task("retention-leased-old"));
    await store.claim(["ai_bank_discovery"], "retention-leased-old");

    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE tasks SET updated_at = ? WHERE id IN (?, ?)",
        now - 8 * 24 * 60 * 60 * 1000,
        "retention-completed-old",
        "retention-dead-old"
      );
      state.storage.sql.exec(
        "UPDATE tasks SET updated_at = ? WHERE id IN (?, ?)",
        now - 40 * 24 * 60 * 60 * 1000,
        "retention-pending-old",
        "retention-leased-old"
      );
      state.storage.sql.exec(
        "INSERT INTO external_request_budgets (budget_day, scope, used, updated_at) VALUES (?, ?, ?, ?)",
        "2026-10-01",
        "ai_bank_discovery",
        1,
        now
      );
    });

    const result = await store.pruneTerminalTasks(now);
    expect(result).toEqual({ completed_deleted: 1, dead_deleted: 1, budget_days_deleted: 1, admission_days_deleted: 0, failures_deleted: 0, audit_deleted: 0, limit: 100 });
    expect(await store.stats()).toEqual({ leased: 1, pending: 1 });
  });

  it("bounds terminal-task and budget-counter cleanup to 100 rows per cycle", async () => {
    const now = Date.parse("2026-11-18T12:00:00.000Z");
    await runInDurableObject(store, async (_instance, state) => {
      for (let index = 0; index < 105; index += 1) {
        const id = `retention-bounded-${String(index).padStart(4, "0")}`;
        const status = index % 2 === 0 ? "completed" : "dead";
        state.storage.sql.exec(
          "INSERT INTO tasks (id, task_type, payload_json, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          id,
          "ai_bank_discovery",
          JSON.stringify({ query: "bounded cleanup test" }),
          status,
          status === "dead" ? 5 : 1,
          now - 40 * 86_400_000,
          now - 40 * 86_400_000
        );
        const budgetDay = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
        state.storage.sql.exec(
          "INSERT INTO external_request_budgets (budget_day, scope, used, updated_at) VALUES (?, ?, ?, ?)",
          budgetDay,
          "ai_bank_discovery",
          1,
          now
        );
      }
    });

    const result = await store.pruneTerminalTasks(now);
    expect(result.completed_deleted + result.dead_deleted).toBe(100);
    expect(result.budget_days_deleted).toBe(100);
    expect(result.limit).toBe(100);
    const remaining = await store.stats();
    expect((remaining.completed || 0) + (remaining.dead || 0)).toBe(5);
  });

  it("retains recently completed and recently dead tasks", async () => {
    const now = Date.parse("2026-11-18T12:00:00.000Z");
    await store.enqueue(task("retention-completed-new"));
    const completedClaim = await store.claim(["ai_bank_discovery"], "retention-completed-new");
    await store.complete("retention-completed-new", completedClaim.lease_token, { ok: true });

    await store.enqueue(task("retention-dead-new"));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claim = await store.claim(["ai_bank_discovery"], "retention-dead-new");
      await store.retry("retention-dead-new", claim.lease_token, "test_failure");
      if (attempt < 4) {
        await runInDurableObject(store, async (_instance, state) => {
          state.storage.sql.exec("UPDATE tasks SET available_at = 0 WHERE id = ?", "retention-dead-new");
        });
      }
    }

    const result = await store.pruneTerminalTasks(now);
    expect(result).toEqual({ completed_deleted: 0, dead_deleted: 0, budget_days_deleted: 0, admission_days_deleted: 0, failures_deleted: 0, audit_deleted: 0, limit: 100 });
    expect(await store.stats()).toEqual({ completed: 1, dead: 1 });
  });

  it("enforces the active queue capacity without accepting the 501st task", async () => {
    const now = Date.now();
    await runInDurableObject(store, async (_instance, state) => {
      for (let index = 0; index < 500; index += 1) {
        const queued = task(`task-capacity-${String(index).padStart(4, "0")}`);
        state.storage.sql.exec(
          "INSERT INTO tasks (id, task_type, payload_json, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)",
          queued.id, queued.task_type, JSON.stringify(queued.payload), now, now
        );
      }
    });

    const overflow = await store.enqueue(task("task-capacity-overflow"));
    expect(overflow).toEqual({ accepted: false, reason: "queue_capacity_reached" });
    expect(await store.stats()).toEqual({ pending: 500 });
  });

  it("caps newly accepted tasks at 100 per UTC day and does not count idempotent duplicates", async () => {
    const first = await store.enqueue(task("daily-admission-0001"));
    const duplicate = await store.enqueue(task("daily-admission-0001"));
    expect(first.accepted).toBe(true);
    expect(duplicate).toMatchObject({ accepted: true, duplicate: true });
    for (let index = 2; index <= 100; index += 1) {
      const result = await store.enqueue(task(`daily-admission-${String(index).padStart(4, "0")}`));
      expect(result.accepted).toBe(true);
    }
    const rejected = await store.enqueue(task("daily-admission-0101"));
    expect(rejected).toEqual({ accepted: false, reason: "daily_task_admission_limit_reached" });
    const usage = await store.getDailyAdmissionUsage();
    expect(usage.accepted).toBe(100);
    expect(usage.limit).toBe(100);
  });

  it("enforces the daily task admission limit under concurrent requests", async () => {
    const results = await Promise.all(Array.from({ length: 110 }, (_, index) =>
      store.enqueue(task(`daily-concurrent-${String(index).padStart(4, "0")}`))
    ));
    expect(results.filter(result => result.accepted)).toHaveLength(100);
    expect(results.filter(result => result.reason === "daily_task_admission_limit_reached")).toHaveLength(10);
    expect((await store.getDailyAdmissionUsage()).accepted).toBe(100);
  });

  it("durably auto-pauses after five terminal failures in ten minutes and audits the transition", async () => {
    for (let index = 1; index <= 5; index += 1) {
      const id = `breaker-terminal-${String(index).padStart(4, "0")}`;
      await store.enqueue(task(id));
      const claim = await store.claim(["ai_bank_discovery"], id);
      expect(claim.task.id).toBe(id);
      const terminal = await store.abandon(id, claim.lease_token, "source_terminal_failure");
      expect(terminal).toMatchObject({ updated: true, status: "dead" });
      const control = await store.getControl();
      expect(control.paused).toBe(index === 5);
      expect(control.failure_count_last_10m).toBe(index);
    }

    expect(await store.enqueue(task("breaker-blocked-0001"))).toEqual({
      accepted: false,
      reason: "circuit_breaker_open"
    });
    expect(await store.claim()).toMatchObject({ task: null, reason: "circuit_breaker_open" });
    const audit = await runInDurableObject(store, async (_instance, state) =>
      state.storage.sql.exec(
        "SELECT event_type, COUNT(*) AS count FROM task_store_audit GROUP BY event_type"
      ).toArray()
    );
    expect(audit).toEqual([{ event_type: "circuit_breaker_auto_pause", count: 1 }]);
  });

  it("includes a terminal failure exactly on the ten-minute circuit-breaker boundary", async () => {
    const windowStart = Date.parse("2026-11-20T00:00:00.000Z");
    for (let index = 1; index <= 4; index += 1) {
      await store.recordTerminalFailure(`breaker-boundary-${String(index).padStart(4, "0")}`, "seed_failure", windowStart);
    }

    const boundary = await store.recordTerminalFailure(
      "breaker-boundary-0005",
      "boundary_failure",
      windowStart + 10 * 60 * 1000
    );

    expect(boundary).toEqual({ failure_count: 5, paused: true });
    expect(await store.getControl()).toMatchObject({ paused: true, reason: "circuit_breaker:5_failures_in_10m" });
  });

  it("expires failures older than the rolling ten-minute window before counting new failures", async () => {
    const windowStart = Date.parse("2026-11-20T00:00:00.000Z");
    for (let index = 1; index <= 4; index += 1) {
      await store.recordTerminalFailure(`breaker-expiry-old-${String(index).padStart(4, "0")}`, "old_failure", windowStart);
    }

    const afterExpiry = windowStart + 10 * 60 * 1000 + 1;
    const firstNewFailure = await store.recordTerminalFailure("breaker-expiry-new-0001", "new_failure", afterExpiry);
    expect(firstNewFailure).toEqual({ failure_count: 1, paused: false });

    for (let index = 2; index <= 4; index += 1) {
      const result = await store.recordTerminalFailure(
        `breaker-expiry-new-${String(index).padStart(4, "0")}`,
        "new_failure",
        afterExpiry + index
      );
      expect(result).toMatchObject({ failure_count: index, paused: false });
    }

    const fifthNewFailure = await store.recordTerminalFailure(
      "breaker-expiry-new-0005",
      "new_failure",
      afterExpiry + 5
    );
    expect(fifthNewFailure).toEqual({ failure_count: 5, paused: true });
  });

  it("does not trip the circuit breaker for non-terminal retries", async () => {
    await store.enqueue(task("breaker-retry-0001"));
    const claim = await store.claim(["ai_bank_discovery"], "breaker-retry-0001");
    const retried = await store.retry("breaker-retry-0001", claim.lease_token, "temporary_source_error");
    expect(retried).toMatchObject({ updated: true, status: "pending" });
    expect(await store.getControl()).toMatchObject({ paused: false, failure_count_last_10m: 0 });
  });
});
