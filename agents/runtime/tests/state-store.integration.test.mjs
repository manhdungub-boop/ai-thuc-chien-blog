import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "state-store-test-worker.mjs");
const TEST_OPERATOR_TOKEN = "integration-test-operator-token-0123456789abcdef";
const TEST_STATE_STORE_TOKEN = "integration-test-state-store-token-0123456789abcdef";

async function createRuntime({ daily = 100, concurrent = 5, persistDir, enabled = "true", paused = "false", resumeControl = true, recoveryAlarmEnabled = "false" } = {}) {
  const directory = persistDir ?? await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-"));
  const mf = new Miniflare({
    modules: true,
    scriptPath: workerPath,
    // Keep the local simulator date within the pinned workerd build (supports through 2026-07-08).
    // This is test-harness-only; the isolated Preview Worker date remains in wrangler.jsonc.
    compatibilityDate: "2026-07-08",
    durableObjects: { AGENT_STATE_STORE: { className: "TestAgentStateStore", useSQLite: true } },
    durableObjectsPersist: directory,
    bindings: {
      AGENT_ENABLED: enabled,
      AGENT_PAUSED: paused,
      AGENT_RECOVERY_ALARM_ENABLED: recoveryAlarmEnabled,
      AGENT_OPERATOR_TOKEN: TEST_OPERATOR_TOKEN,
      AGENT_STATE_STORE_TOKEN: TEST_STATE_STORE_TOKEN,
      RUNTIME_MAX_TASKS_PER_DAY: String(daily),
      RUNTIME_MAX_CONCURRENT_TASKS: String(concurrent),
    },
  });
  const namespace = await mf.getDurableObjectNamespace("AGENT_STATE_STORE");
  const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
  // Tests that exercise an enabled runtime explicitly open the durable control gate.
  // Fresh-store defaults remain paused unless the test opts into this fixture setup.
  if (resumeControl && enabled === "true" && paused === "false") {
    const opened = await call(stub, "/control/resume", {
      actor: "integration-test",
      requestId: crypto.randomUUID(),
      reason: "test fixture initialization",
    });
    if (opened.status !== 200) throw new Error("test_fixture_control_resume_failed");
  }
  return { mf, stub, directory };
}

async function withRuntime(options, callback) {
  const runtime = await createRuntime(options);
  try { return await callback(runtime); }
  finally {
    await runtime.mf.dispose();
    if (!options?.persistDir) await rm(runtime.directory, { recursive: true, force: true });
  }
}
function task(id, payload = { path: "/guides" }) {
  return { task: { type: "seo.audit", idempotencyKey: "integration-test-key-" + id.padEnd(16, "x"), payload } };
}
async function call(stub, pathname, body, headers = {}) {
  const response = await stub.fetch("http://do.local" + pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: "Bearer " + TEST_STATE_STORE_TOKEN, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test("read-only metrics report bounded aggregate task, quota, age, and audit data", async () => {
  await withRuntime({ daily: 10, concurrent: 4 }, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("metrics-queued"));
    assert.equal(created.status, 201);
    const metrics = await call(stub, "/metrics");
    assert.equal(metrics.status, 200);
    assert.equal(metrics.body.ok, true);
    assert.equal(metrics.body.tasks.totalRetained, 1);
    assert.equal(metrics.body.tasks.queued, 1);
    assert.equal(metrics.body.tasks.queuedDue, 1);
    assert.equal(metrics.body.tasks.running, 0);
    assert.equal(metrics.body.tasks.oldestQueuedAgeMs >= 0, true);
    assert.equal(metrics.body.tasks.oldestRunningUpdateAgeMs, null);
    assert.equal(metrics.body.quota.acceptedToday, 1);
    assert.equal(metrics.body.quota.dailyLimit, 10);
    assert.equal(metrics.body.quota.dailyUtilizationPercent, 10);
    assert.equal(metrics.body.quota.dailyPressure, "normal");
    assert.equal(metrics.body.quota.concurrentPressure, "normal");
    assert.equal(metrics.body.quota.overallPressure, "normal");
    assert.equal(metrics.body.quota.inFlight, 1);
    assert.equal(metrics.body.quota.concurrentLimit, 4);
    assert.equal(metrics.body.quota.concurrentUtilizationPercent, 25);
    assert.ok(Array.isArray(metrics.body.auditLast24h));
    assert.ok(metrics.body.auditLast24h.length <= 20);
    assert.match(metrics.body.note, /not a measurement of provider or Cloudflare account quota/);
    assert.equal((await call(stub, "/metrics?day=2026-11-20")).status, 400);
    assert.equal(JSON.stringify(metrics.body).includes("integration-test-key"), false);
  });
});

test("metrics distinguish qualifying breaker failures from budget failures and pause actor from reason text", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("metrics-budget-failure"));
    assert.equal(created.status, 201);
    const claimed = await call(stub, "/claim", { taskId: created.body.task.taskId });
    assert.equal(claimed.status, 200);
    const completed = await call(stub, "/complete", {
      taskId: created.body.task.taskId,
      leaseOwner: claimed.body.lease.owner,
      leaseGeneration: claimed.body.lease.generation,
      status: "failed",
      errorCode: "daily_external_request_budget_exhausted",
    });
    assert.equal(completed.status, 200);

    const paused = await call(stub, "/control/pause", {
      actor: "integration-test",
      requestId: crypto.randomUUID(),
      reason: "circuit_breaker:5_failures_in_10m",
    });
    assert.equal(paused.status, 200);

    const metrics = await call(stub, "/metrics");
    assert.equal(metrics.status, 200);
    assert.equal(metrics.body.circuitBreaker.paused, true);
    assert.equal(metrics.body.circuitBreaker.failureCountLast10m, 0);
    assert.equal(metrics.body.circuitBreaker.autoPaused, false);
    assert.equal(metrics.body.circuitBreaker.state, "closed");
  });
});

test("quota pressure reports daily 80/90/100 and concurrent 80/100 boundaries without changing admission policy", async () => {
  await withRuntime({ daily: 10, concurrent: 5 }, async ({ stub }) => {
    for (let index = 0; index < 8; index++) {
      const created = await call(stub, "/reserve", task(`daily-pressure-${index}`));
      assert.equal(created.status, 201);
      const claimed = await call(stub, "/claim", { taskId: created.body.task.taskId });
      assert.equal(claimed.status, 200);
      const completed = await call(stub, "/complete", {
        taskId: created.body.task.taskId, leaseOwner: claimed.body.lease.owner,
        leaseGeneration: claimed.body.lease.generation, status: "succeeded",
      });
      assert.equal(completed.status, 200);
    }
    let metrics = await call(stub, "/metrics");
    assert.equal(metrics.body.quota.dailyUtilizationPercent, 80);
    assert.equal(metrics.body.quota.dailyPressure, "warning");
    for (let index = 8; index < 9; index++) {
      const created = await call(stub, "/reserve", task(`daily-pressure-${index}`));
      assert.equal(created.status, 201);
      const claimed = await call(stub, "/claim", { taskId: created.body.task.taskId });
      const completed = await call(stub, "/complete", {
        taskId: created.body.task.taskId, leaseOwner: claimed.body.lease.owner,
        leaseGeneration: claimed.body.lease.generation, status: "succeeded",
      });
      assert.equal(completed.status, 200);
    }
    metrics = await call(stub, "/metrics");
    assert.equal(metrics.body.quota.dailyUtilizationPercent, 90);
    assert.equal(metrics.body.quota.dailyPressure, "critical");
    assert.equal(metrics.body.quota.overallPressure, "critical");
    const last = await call(stub, "/reserve", task("daily-pressure-9"));
    assert.equal(last.status, 201);
    const lastClaim = await call(stub, "/claim", { taskId: last.body.task.taskId });
    await call(stub, "/complete", {
      taskId: last.body.task.taskId, leaseOwner: lastClaim.body.lease.owner,
      leaseGeneration: lastClaim.body.lease.generation, status: "succeeded",
    });
    metrics = await call(stub, "/metrics");
    assert.equal(metrics.body.quota.dailyUtilizationPercent, 100);
    assert.equal(metrics.body.quota.dailyPressure, "exhausted");
    assert.equal(metrics.body.quota.overallPressure, "exhausted");
    assert.equal((await call(stub, "/reserve", task("daily-pressure-blocked"))).body.error, "daily_quota_exhausted");
  });
  await withRuntime({ daily: 20, concurrent: 5 }, async ({ stub }) => {
    for (let index = 0; index < 4; index++) assert.equal((await call(stub, "/reserve", task(`concurrent-pressure-${index}`))).status, 201);
    let metrics = await call(stub, "/metrics");
    assert.equal(metrics.body.quota.concurrentUtilizationPercent, 80);
    assert.equal(metrics.body.quota.concurrentPressure, "warning");
    assert.equal(metrics.body.quota.overallPressure, "warning");
    assert.equal((await call(stub, "/reserve", task("concurrent-pressure-4"))).status, 201);
    metrics = await call(stub, "/metrics");
    assert.equal(metrics.body.quota.concurrentUtilizationPercent, 100);
    assert.equal(metrics.body.quota.concurrentPressure, "exhausted");
    assert.equal(metrics.body.quota.overallPressure, "exhausted");
    assert.equal((await call(stub, "/reserve", task("concurrent-pressure-blocked"))).body.error, "concurrency_limit_reached");
  });
});

test("dead-letter inspection returns bounded failed-task metadata with stable cursor pagination", async () => {
  await withRuntime({}, async ({ stub }) => {
    const recoveryBody = (taskId) => ({
      taskId, actor: "integration-test", requestId: crypto.randomUUID(),
    });
    async function failAfterLeaseRetries(id, start) {
      const created = await call(stub, "/reserve", task(id));
      const taskId = created.body.task.taskId;
      const first = await call(stub, "/claim", { taskId }, { "x-test-now": new Date(start).toISOString() });
      assert.equal(first.status, 200);
      const recovered1 = await call(stub, "/recover", recoveryBody(taskId), { "x-test-now": new Date(start + 5 * 60_000).toISOString() });
      assert.equal(recovered1.body.outcome, "requeued");
      const second = await call(stub, "/claim", { taskId }, { "x-test-now": new Date(start + 5.5 * 60_000).toISOString() });
      assert.equal(second.status, 200);
      const recovered2 = await call(stub, "/recover", recoveryBody(taskId), { "x-test-now": new Date(start + 10.5 * 60_000).toISOString() });
      assert.equal(recovered2.body.outcome, "requeued");
      const third = await call(stub, "/claim", { taskId }, { "x-test-now": new Date(start + 25 * 60_000).toISOString() });
      assert.equal(third.status, 200);
      const failed = await call(stub, "/recover", recoveryBody(taskId), { "x-test-now": new Date(start + 30 * 60_000).toISOString() });
      assert.equal(failed.status, 200);
      assert.equal(failed.body.outcome, "failed");
      return taskId;
    }

    const base = Date.parse("2026-11-19T10:00:00.000Z");
    const olderTaskId = await failAfterLeaseRetries("dead-letter-older", base);
    const newerTaskId = await failAfterLeaseRetries("dead-letter-newer", base + 60 * 60_000);
    const first = await call(stub, "/dead-letter?limit=1");
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 1);
    assert.equal(first.body.items[0].taskId, newerTaskId);
    assert.equal(first.body.items[0].errorCode, "lease_expired_max_attempts");
    assert.deepEqual(first.body.items[0].classification, {
      category: "transient", confidence: "high", recommendedAction: "inspect_provider_or_network_health",
    });
    assert.equal(first.body.items[0].attemptCount, 3);
    assert.equal(first.body.nextCursor.taskId, newerTaskId);
    assert.equal("payload" in first.body.items[0], false);
    assert.equal("idempotencyKey" in first.body.items[0], false);

    const cursor = first.body.nextCursor;
    const second = await call(stub, "/dead-letter?limit=1&beforeTerminalAt=" + cursor.terminalAt + "&beforeTaskId=" + encodeURIComponent(cursor.taskId));
    assert.equal(second.status, 200);
    assert.equal(second.body.items.length, 1);
    assert.equal(second.body.items[0].taskId, olderTaskId);
    assert.equal(second.body.nextCursor, null);

    assert.equal((await call(stub, "/dead-letter?limit=0")).status, 400);
    assert.equal((await call(stub, "/dead-letter?limit=1&beforeTerminalAt=123")).status, 400);
    assert.equal((await call(stub, "/dead-letter?limit=1&limit=2")).status, 400);
    assert.equal((await call(stub, "/dead-letter?limit=51")).status, 400);
  });
});

test("schema v7 repairs either historical v6 layout without losing the other migration", async () => {
  for (const layout of ["budget-only", "result-only"]) {
    const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-schema-v6-"));
    let first;
    try {
      first = await createRuntime({ persistDir: directory });
      const initial = await call(first.stub, "/__test/schema-state");
      assert.equal(initial.body.version, "7");
      const downgraded = await call(first.stub, "/__test/downgrade-v6-" + layout, {});
      assert.equal(downgraded.status, 200);
      const beforeRestart = await call(first.stub, "/__test/schema-state");
      assert.equal(beforeRestart.body.version, "6");
      assert.equal(beforeRestart.body.hasExternalRequestBudgets, layout === "budget-only");
      assert.equal(beforeRestart.body.hasResultJson, layout === "result-only");
    } finally {
      if (first) await first.mf.dispose();
    }

    let reopened;
    try {
      reopened = await createRuntime({ persistDir: directory, resumeControl: false });
      const state = await call(reopened.stub, "/__test/schema-state");
      assert.deepEqual(state.body, {
        ok: true,
        version: "7",
        hasResultJson: true,
        hasExternalRequestBudgets: true,
      }, "migration must complete from the " + layout + " v6 layout");
      const budget = await call(reopened.stub, "/external-budget?day=2026-11-21&scope=ai_bank_discovery");
      assert.equal(budget.status, 200);
      assert.equal(budget.body.budget.remaining, 10);
    } finally {
      if (reopened) await reopened.mf.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("lease recovery alarm is disabled by default and recovers only expired leases when explicitly enabled", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("alarm-disabled"));
    const claimed = await call(stub, "/claim", { taskId: created.body.task.taskId });
    assert.equal(claimed.status, 200);
    const alarm = await call(stub, "/__test/alarm-state");
    assert.equal(alarm.body.alarmAt, null, "default-off recovery alarm must not schedule billable events");
  });

  await withRuntime({ recoveryAlarmEnabled: "true" }, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("alarm-enabled"));
    const taskId = created.body.task.taskId;
    const claimed = await call(stub, "/claim", { taskId });
    assert.equal(claimed.status, 200);
    const scheduled = await call(stub, "/__test/alarm-state");
    assert.equal(typeof scheduled.body.alarmAt, "number");
    assert.ok(scheduled.body.alarmAt >= Date.now() + 4 * 60 * 1000);

    const fired = await call(stub, "/__test/expire-and-fire", { taskId });
    assert.equal(fired.body.task.state, "queued");
    assert.equal(fired.body.task.lease_owner, null);
    assert.equal(typeof fired.body.task.next_attempt_at, "number");
    assert.equal(fired.body.alarmAt, null, "no running leases should leave no scheduled alarm");
    const stored = await call(stub, "/task?id=" + encodeURIComponent(taskId));
    assert.equal(stored.body.task.state, "queued");
    assert.equal(stored.body.task.attemptCount, 1);
  });
});

test("recovery alarm stops and clears itself while the durable operator pause cancels running work", async () => {
  await withRuntime({ recoveryAlarmEnabled: "true" }, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("alarm-paused"));
    const taskId = created.body.task.taskId;
    assert.equal((await call(stub, "/claim", { taskId })).status, 200);
    assert.equal(typeof (await call(stub, "/__test/alarm-state")).body.alarmAt, "number");
    const paused = await call(stub, "/control/pause", {
      actor: "alarm-test-operator",
      requestId: crypto.randomUUID(),
      reason: "pause alarm test",
    });
    assert.equal(paused.status, 200);
    const fired = await call(stub, "/__test/fire-alarm", {});
    assert.equal(fired.body.alarmAt, null);
    const stored = await call(stub, "/task?id=" + encodeURIComponent(taskId));
    assert.equal(stored.body.task.state, "cancelled", "emergency pause must cancel the in-flight lease");
  });
});

test("pause clears the recovery alarm and resume does not re-arm a cancelled lease", async () => {
  await withRuntime({ recoveryAlarmEnabled: "true" }, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("alarm-pause-resume"));
    const taskId = created.body.task.taskId;
    assert.equal((await call(stub, "/claim", { taskId })).status, 200);
    const initiallyScheduled = await call(stub, "/__test/alarm-state");
    assert.equal(typeof initiallyScheduled.body.alarmAt, "number");

    const paused = await call(stub, "/control/pause", {
      actor: "alarm-resume-operator", requestId: crypto.randomUUID(), reason: "maintenance",
    });
    assert.equal(paused.status, 200);
    assert.equal((await call(stub, "/__test/alarm-state")).body.alarmAt, null,
      "pause must clear a pending recovery alarm immediately");

    const resumed = await call(stub, "/control/resume", {
      actor: "alarm-resume-operator", requestId: crypto.randomUUID(), reason: "maintenance complete",
    });
    assert.equal(resumed.status, 200);
    const rearmed = await call(stub, "/__test/alarm-state");
    assert.equal(rearmed.body.alarmAt, null,
      "cancelled in-flight work must not create a recovery alarm after resume");
    assert.equal((await call(stub, "/task?id=" + encodeURIComponent(taskId))).body.task.state, "cancelled",
      "resume must not revive a task cancelled by the emergency pause");
    assert.equal((await call(stub, "/usage")).body.inFlight, 0);
  });
});

test("all state-store routes require the distinct internal credential", async () => {
  await withRuntime({}, async ({ stub }) => {
    for (const [pathname, body] of [
      ["/reserve", task("unauth-reserve")],
      ["/claim", { taskId: "missing" }],
      ["/claim-next", {}],
      ["/heartbeat", { taskId: "missing", leaseOwner: "a1b2c3d4-e5f6-4711-8123-abcdef012345", leaseGeneration: 1 }],
      ["/complete", { taskId: "missing", leaseOwner: "a1b2c3d4-e5f6-4711-8123-abcdef012345", leaseGeneration: 1, status: "succeeded" }],
      ["/recover", { taskId: "missing" }],
      ["/transition", { taskId: "missing", status: "running" }],
      ["/control", undefined],
      ["/oidc/replay/consume", { jti: "test-jti-auth-check-001", expiresAt: "1799999999" }],
      ["/control/pause", {}],
      ["/control/resume", {}],
      ["/task?id=missing", undefined],
      ["/usage", undefined],
      ["/external-budget?day=2026-11-21&scope=ai_bank_discovery", undefined],
      ["/external-budget/consume", { day: "2026-11-21", scope: "ai_bank_discovery" }],
      ["/__test/rollback", {}],
      ["/__test/downgrade-v1", {}],
      ["/__test/prune", { now: 1799999999000 }],
    ]) {
      const missing = await call(stub, pathname, body, { Authorization: "" });
      const invalid = await call(stub, pathname, body, { Authorization: "Bearer invalid-token" });
      const externalOperator = await call(stub, pathname, body, { Authorization: "Bearer " + TEST_OPERATOR_TOKEN });
      assert.equal(externalOperator.status, 401, pathname + " must reject the external operator credential");
      assert.equal(missing.status, 401, pathname + " missing token");
      assert.equal(invalid.status, 401, pathname + " invalid token");
      assert.equal(missing.body.error, "state_store_auth_required");
      assert.equal(invalid.body.error, "state_store_auth_required");
    }
  });
});

test("state-store admission fails closed while disabled or paused", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-paused-"));
  const mf = new Miniflare({
    modules: true,
    scriptPath: workerPath,
    compatibilityDate: "2026-07-08",
    durableObjects: { AGENT_STATE_STORE: { className: "TestAgentStateStore", useSQLite: true } },
    durableObjectsPersist: directory,
    bindings: { AGENT_OPERATOR_TOKEN: TEST_OPERATOR_TOKEN, AGENT_STATE_STORE_TOKEN: TEST_STATE_STORE_TOKEN, AGENT_ENABLED: "false", AGENT_PAUSED: "true" },
  });
  try {
    const namespace = await mf.getDurableObjectNamespace("AGENT_STATE_STORE");
    const stub = namespace.get(namespace.idFromName("agent-runtime-paused"));
    const response = await call(stub, "/reserve", task("paused-admission"));
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "agent_disabled_or_paused");
    const usage = await call(stub, "/usage");
    assert.equal(usage.body.acceptedToday, 0);
    assert.equal(usage.body.inFlight, 0);
  } finally {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("pause switch blocks queued-to-running transitions but permits terminal cancellation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-pause-transition-"));
  let active;
  let paused;
  try {
    active = await createRuntime({ persistDir: directory });
    const created = await call(active.stub, "/reserve", task("pause-transition"));
    assert.equal(created.status, 201);
    const taskId = created.body.task.taskId;
    await active.mf.dispose();
    active = null;

    paused = await createRuntime({ persistDir: directory, enabled: "false", paused: "true" });
    const blocked = await call(paused.stub, "/transition", { taskId, status: "running" });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error, "agent_disabled_or_paused");

    const cancelled = await call(paused.stub, "/transition", { taskId, status: "cancelled" });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.task.state, "cancelled");
    assert.equal((await call(paused.stub, "/usage")).body.inFlight, 0);
  } finally {
    if (active) await active.mf.dispose();
    if (paused) await paused.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("emergency pause atomically cancels running leases and fences late heartbeats/completions", async () => {
  await withRuntime({}, async ({ stub }) => {
    const runningCreated = await call(stub, "/reserve", task("pause-running-lease"));
    const queuedCreated = await call(stub, "/reserve", task("pause-queued-task"));
    assert.equal(runningCreated.status, 201);
    assert.equal(queuedCreated.status, 201);
    const taskId = runningCreated.body.task.taskId;
    const queuedId = queuedCreated.body.task.taskId;
    const claimed = await call(stub, "/claim", { taskId });
    assert.equal(claimed.status, 200);

    const paused = await call(stub, "/control/pause", {
      actor: "emergency-stop-test",
      requestId: crypto.randomUUID(),
      reason: "fault injection: emergency stop",
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.control.paused, true);

    const cancelled = await call(stub, "/task?id=" + encodeURIComponent(taskId));
    assert.equal(cancelled.body.task.state, "cancelled");
    assert.equal(cancelled.body.task.errorCode, "operator_paused");
    assert.equal(cancelled.body.task.leaseExpiresAt, null);

    const lateHeartbeat = await call(stub, "/heartbeat", {
      taskId, leaseOwner: claimed.body.lease.owner, leaseGeneration: claimed.body.lease.generation,
    });
    assert.equal(lateHeartbeat.status, 409);

    const lateCompletion = await call(stub, "/complete", {
      taskId, leaseOwner: claimed.body.lease.owner,
      leaseGeneration: claimed.body.lease.generation, status: "succeeded",
    });
    assert.equal(lateCompletion.status, 409);

    assert.equal((await call(stub, "/task?id=" + encodeURIComponent(queuedId))).body.task.state, "queued",
      "pause fences running work but preserves queued work for explicit later handling");
    assert.equal((await call(stub, "/claim", { taskId: queuedId })).status, 503);
    assert.equal((await call(stub, "/usage")).body.inFlight, 1);
  });
});

test("durable pause is atomic, survives restart, and resume never dispatches queued work", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-durable-control-"));
  let active;
  let restarted;
  try {
    active = await createRuntime({ persistDir: directory });
    const created = await call(active.stub, "/reserve", task("durable-control"));
    assert.equal(created.status, 201);
    const taskId = created.body.task.taskId;
    const paused = await call(active.stub, "/control/pause", { actor: "test-operator", requestId: crypto.randomUUID(), reason: "operator maintenance" });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.changed, true);
    assert.equal(paused.body.control.paused, true);
    const duplicatePause = await call(active.stub, "/control/pause", { actor: "test-operator", requestId: crypto.randomUUID(), reason: "duplicate" });
    assert.equal(duplicatePause.status, 200);
    assert.equal(duplicatePause.body.changed, false);
    assert.equal((await call(active.stub, "/reserve", task("durable-control-blocked"))).status, 503);
    assert.equal((await call(active.stub, "/claim", { taskId })).status, 503);

    await active.mf.dispose();
    active = null;
    restarted = await createRuntime({ persistDir: directory, resumeControl: false });
    const persisted = await call(restarted.stub, "/control");
    assert.equal(persisted.body.control.paused, true);
    assert.equal(persisted.body.control.version, 2);
    assert.equal((await call(restarted.stub, "/claim", { taskId })).status, 503);

    const resumed = await call(restarted.stub, "/control/resume", { actor: "test-operator", requestId: crypto.randomUUID(), reason: "maintenance complete" });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.changed, true);
    assert.equal(resumed.body.control.paused, false);
    assert.equal((await call(restarted.stub, "/task?id=" + encodeURIComponent(taskId))).body.task.state, "queued");
    assert.equal((await call(restarted.stub, "/usage")).body.inFlight, 1);
    assert.equal((await call(restarted.stub, "/claim", { taskId })).status, 200);
    assert.equal((await call(restarted.stub, "/control/pause", { actor: "test-operator", requestId: crypto.randomUUID(), reason: "bad\nreason" })).status, 400);
  } finally {
    if (active) await active.mf.dispose();
    if (restarted) await restarted.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("control mutations enforce per-operator durable rate limits", async () => {
  await withRuntime({}, async ({ stub }) => {
    const requests = [];
    for (let index = 0; index < 11; index += 1) {
      requests.push(call(stub, "/control/pause", {
        actor: "rate-limit-test",
        requestId: crypto.randomUUID(),
        reason: "rate limit probe",
      }));
    }
    const results = await Promise.all(requests);
    assert.equal(results.filter((result) => result.status === 200).length, 10);
    assert.equal(results.filter((result) => result.status === 429).length, 1);
  });
});

test("concurrent paused admission and claim attempts remain fail-closed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-pause-race-"));
  let active;
  let paused;
  try {
    active = await createRuntime({ persistDir: directory });
    const created = await call(active.stub, "/reserve", task("pause-race-existing"));
    assert.equal(created.status, 201);
    const taskId = created.body.task.taskId;
    await active.mf.dispose();
    active = null;

    paused = await createRuntime({ persistDir: directory, enabled: "false", paused: "true" });
    const attempts = await Promise.all([
      ...Array.from({ length: 12 }, (_, index) =>
        call(paused.stub, "/reserve", task("pause-race-new-" + index))),
      ...Array.from({ length: 12 }, () =>
        call(paused.stub, "/claim", { taskId })),
    ]);

    assert.equal(attempts.length, 24);
    assert.ok(attempts.every((result) =>
      result.status === 503 && result.body.error === "agent_disabled_or_paused"));
    const usage = await call(paused.stub, "/usage");
    assert.equal(usage.body.acceptedToday, 1);
    assert.equal(usage.body.inFlight, 1);
    const existing = await call(paused.stub, "/task?id=" + encodeURIComponent(taskId));
    assert.equal(existing.body.task.state, "queued");
    assert.equal(existing.body.task.attemptCount, 0);
  } finally {
    if (active) await active.mf.dispose();
    if (paused) await paused.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite Durable Object reserves once and rejects idempotency payload conflicts", async () => {
  await withRuntime({}, async ({ stub }) => {
    const input = task("dedupe");
    const first = await call(stub, "/reserve", input);
    const duplicate = await call(stub, "/reserve", input);
    const conflict = await call(stub, "/reserve", { ...input, task: { ...input.task, payload: { path: "/other" } } });
    assert.equal(first.status, 201);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.task.taskId, first.body.task.taskId);
    assert.equal(conflict.status, 409);
    const usage = await call(stub, "/usage");
    assert.equal(usage.body.acceptedToday, 1);
    assert.equal(usage.body.inFlight, 1);
  });
});

test("concurrent duplicate reservations admit one task and reject conflicting payloads", async () => {
  await withRuntime({}, async ({ stub }) => {
    const input = task("parallel-dedupe");
    const duplicates = await Promise.all([
      call(stub, "/reserve", input),
      call(stub, "/reserve", input),
      call(stub, "/reserve", input),
    ]);
    assert.equal(duplicates.filter((item) => item.status === 201).length, 1);
    assert.equal(duplicates.filter((item) => item.status === 200 && item.body.duplicate === true).length, 2);
    assert.equal(new Set(duplicates.map((item) => item.body.task.taskId)).size, 1);

    const conflict = await call(stub, "/reserve", {
      ...input,
      task: { ...input.task, payload: { path: "/different-payload" } },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "idempotency_key_conflict");

    const usage = await call(stub, "/usage");
    assert.equal(usage.body.acceptedToday, 1,
      "concurrent retries must consume exactly one daily admission slot");
    assert.equal(usage.body.inFlight, 1);
  });
});

test("default Free-tier pilot concurrency is capped at five tasks", async () => {
  await withRuntime({}, async ({ stub }) => {
    const results = await Promise.all(["default-a","default-b","default-c","default-d","default-e","default-f"].map((id) => call(stub, "/reserve", task(id))));
    assert.equal(results.filter((item) => item.status === 201).length, 5);
    assert.equal(results.filter((item) => item.body.error === "concurrency_limit_reached").length, 1);
    const usage = await call(stub, "/usage");
    assert.equal(usage.body.acceptedToday, 5);
    assert.equal(usage.body.inFlight, 5);
  });
});

test("daily quota is reserved atomically at the boundary", async () => {
  await withRuntime({ daily: 2 }, async ({ stub }) => {
    const results = await Promise.all(["quota-a","quota-b","quota-c","quota-d"].map((id) => call(stub, "/reserve", task(id))));
    assert.equal(results.filter((item) => item.status === 201).length, 2);
    assert.equal(results.filter((item) => item.body.error === "daily_quota_exhausted").length, 2);
    const usage = await call(stub, "/usage");
    assert.equal(usage.body.acceptedToday, 2);
    assert.equal(usage.body.inFlight, 2);
  });
});

test("concurrent admissions respect the in-flight limit and terminal transitions release capacity once", async () => {
  await withRuntime({ daily: 10, concurrent: 2 }, async ({ stub }) => {
    const results = await Promise.all(["parallel-a","parallel-b","parallel-c","parallel-d"].map((id) => call(stub, "/reserve", task(id))));
    const accepted = results.filter((item) => item.status === 201);
    assert.equal(accepted.length, 2);
    assert.equal(results.filter((item) => item.body.error === "concurrency_limit_reached").length, 2);
    const taskId = accepted[0].body.task.taskId;
    const claimed = await call(stub, "/claim", { taskId });
    assert.equal(claimed.status, 200);
    const completed = await call(stub, "/complete", {
      taskId, leaseOwner: claimed.body.lease.owner,
      leaseGeneration: claimed.body.lease.generation, status: "succeeded",
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.task.state, "succeeded");
    assert.equal((await call(stub, "/reserve", task("after-release"))).status, 201);
    const usage = await call(stub, "/usage");
    assert.equal(usage.body.acceptedToday, 3);
    assert.equal(usage.body.inFlight, 2);
  });
});

test("state transitions reject invalid paths and do not reopen terminal tasks", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("transitions"));
    const taskId = created.body.task.taskId;
    assert.equal((await call(stub, "/transition", { taskId, status: "succeeded" })).status, 409);
    assert.equal((await call(stub, "/transition", { taskId, status: "running" })).status, 409);
    const claimed = await call(stub, "/claim", { taskId });
    assert.equal(claimed.status, 200);
    assert.equal((await call(stub, "/transition", { taskId, status: "failed", errorCode: "review_failed" })).body.error, "lease_required");
    const completed = await call(stub, "/complete", {
      taskId, leaseOwner: claimed.body.lease.owner,
      leaseGeneration: claimed.body.lease.generation, status: "failed", errorCode: "review_failed",
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.task.state, "failed");
    assert.equal((await call(stub, "/transition", { taskId, status: "running" })).status, 409);
    assert.equal((await call(stub, "/usage")).body.inFlight, 0);
  });
});

test("UTC day rollover uses separate durable quota buckets", async () => {
  await withRuntime({ daily: 1 }, async ({ stub }) => {
    assert.equal((await call(stub, "/reserve", task("utc-before"), { "x-test-now": "2026-11-19T23:59:59.000Z" })).status, 201);
    assert.equal((await call(stub, "/reserve", task("utc-after"), { "x-test-now": "2026-11-20T00:00:01.000Z" })).status, 201);
    assert.equal((await call(stub, "/usage?day=2026-11-19")).body.acceptedToday, 1);
    assert.equal((await call(stub, "/usage?day=2026-11-20")).body.acceptedToday, 1);
  });
});

test("transactionSync rolls back all writes when its callback throws", async () => {
  await withRuntime({}, async ({ stub }) => {
    const result = await call(stub, "/__test/rollback", {});
    assert.equal(result.status, 200);
    assert.equal(result.body.rolledBack, true);
    assert.equal(result.body.acceptedToday, 0);
  });
});

test("SQLite state survives a Miniflare runtime restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-restart-"));
  let first;
  try {
    first = await createRuntime({ persistDir: directory });
    const created = await call(first.stub, "/reserve", task("restart"));
    assert.equal(created.status, 201);
    const taskId = created.body.task.taskId;
    await first.mf.dispose();
    first = null;
    const second = await createRuntime({ persistDir: directory });
    const restored = await call(second.stub, "/task?id=" + encodeURIComponent(taskId));
    const usage = await call(second.stub, "/usage");
    assert.equal(restored.status, 200);
    assert.equal(restored.body.task.state, "queued");
    assert.equal(usage.body.acceptedToday, 1);
    assert.equal(usage.body.inFlight, 1);
    await second.mf.dispose();
  } finally {
    if (first) await first.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});


test("fresh State Store initializes schema v5 paused with conservative lease defaults", async () => {
  await withRuntime({ resumeControl: false }, async ({ stub }) => {
    const initialControl = await call(stub, "/control");
    assert.equal(initialControl.body.control.paused, true);
    assert.equal(initialControl.body.control.version, 0);
    const opened = await call(stub, "/control/resume", {
      actor: "integration-test",
      requestId: crypto.randomUUID(),
      reason: "explicit test gate opening",
    });
    assert.equal(opened.status, 200);
    const created = await call(stub, "/reserve", task("schema-v5-fresh"));
    assert.equal(created.status, 201);
    assert.equal(created.body.task.attemptCount, 0);
    assert.equal(created.body.task.maxAttempts, 3);
    assert.equal(created.body.task.leaseGeneration, 0);
    assert.equal(created.body.task.leaseExpiresAt, null);
    assert.equal(created.body.task.nextAttemptAt, null);
    assert.equal(created.body.task.lastErrorCode, null);
  });
});

test("running lease and recovery alarm survive a Durable Object runtime restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-alarm-restart-"));
  let first;
  let second;
  try {
    first = await createRuntime({ persistDir: directory, recoveryAlarmEnabled: "true" });
    const created = await call(first.stub, "/reserve", task("alarm-restart-running"));
    assert.equal(created.status, 201);
    const taskId = created.body.task.taskId;
    const claimed = await call(first.stub, "/claim", { taskId });
    assert.equal(claimed.status, 200);
    const before = await call(first.stub, "/__test/alarm-state");
    assert.equal(typeof before.body.alarmAt, "number");
    const beforeControl = await call(first.stub, "/control");
    assert.equal(beforeControl.body.control.paused, false);
    await first.mf.dispose();
    first = null;

    second = await createRuntime({ persistDir: directory, recoveryAlarmEnabled: "true", resumeControl: false });
    const after = await call(second.stub, "/__test/alarm-state");
    const restored = await call(second.stub, "/task?id=" + encodeURIComponent(taskId));
    const afterControl = await call(second.stub, "/control");
    assert.equal(after.body.alarmAt, before.body.alarmAt,
      "Durable Object alarm deadline must persist across runtime restart");
    assert.equal(restored.body.task.state, "running");
    assert.equal(restored.body.task.leaseGeneration, claimed.body.lease.generation);
    assert.equal(afterControl.body.control.paused, false,
      "durable operator control state must persist across runtime restart");
  } finally {
    if (first) await first.mf.dispose();
    if (second) await second.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("persisted v1 State Store migrates transactionally to v6 without losing task or usage", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-v1-migration-"));
  let first;
  let second;
  try {
    first = await createRuntime({ persistDir: directory });
    const created = await call(first.stub, "/reserve", task("schema-v1-migration"));
    assert.equal(created.status, 201);
    const taskId = created.body.task.taskId;

    const downgraded = await call(first.stub, "/__test/downgrade-v1", {});
    assert.equal(downgraded.status, 200);
    assert.equal(downgraded.body.schemaVersion, 1);
    await first.mf.dispose();
    first = null;

    second = await createRuntime({ persistDir: directory });
    const restored = await call(second.stub, "/task?id=" + encodeURIComponent(taskId));
    const usage = await call(second.stub, "/usage");
    assert.equal(restored.status, 200);
    assert.equal(restored.body.task.state, "queued");
    assert.equal(restored.body.task.attemptCount, 0);
    assert.equal(restored.body.task.maxAttempts, 3);
    assert.equal(restored.body.task.leaseGeneration, 0);
    assert.equal(restored.body.task.leaseOwner, undefined);
    assert.equal(restored.body.task.leaseExpiresAt, null);
    assert.equal(restored.body.task.leaseMaxExpiresAt, null);
    assert.equal(restored.body.task.nextAttemptAt, null);
    assert.equal(restored.body.task.lastErrorCode, null);
    assert.equal(restored.body.task.result, null, "legacy tasks must migrate without an invented result");
    assert.equal(usage.body.acceptedToday, 1);
    assert.equal(usage.body.inFlight, 1);
  } finally {
    if (first) await first.mf.dispose();
    if (second) await second.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});


test("bounded queue claim atomically selects the oldest due task and stops when empty or paused", async () => {
  await withRuntime({}, async ({ stub }) => {
    const first = await call(stub, "/reserve", task("dispatch-first"), { "x-test-now": "2026-11-19T10:00:00.000Z" });
    const second = await call(stub, "/reserve", task("dispatch-second"), { "x-test-now": "2026-11-19T10:00:01.000Z" });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    const claimedFirst = await call(stub, "/claim-next", {}, { "x-test-now": "2026-11-19T10:00:02.000Z" });
    assert.equal(claimedFirst.status, 200);
    assert.equal(claimedFirst.body.task.taskId, first.body.task.taskId);
    assert.equal(claimedFirst.body.task.state, "running");
    assert.equal(typeof claimedFirst.body.lease.owner, "string");

    const claimedSecond = await call(stub, "/claim-next", {}, { "x-test-now": "2026-11-19T10:00:02.000Z" });
    assert.equal(claimedSecond.status, 200);
    assert.equal(claimedSecond.body.task.taskId, second.body.task.taskId);

    const empty = await call(stub, "/claim-next", {}, { "x-test-now": "2026-11-19T10:00:02.000Z" });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.task, null);
    assert.equal(empty.body.lease, null);

    const paused = await call(stub, "/control/pause", {
      actor: "queue-dispatch-test",
      requestId: crypto.randomUUID(),
      reason: "verify dispatch stop",
    });
    assert.equal(paused.status, 200);
    const blocked = await call(stub, "/claim-next", {}, { "x-test-now": "2026-11-19T10:00:03.000Z" });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error, "agent_disabled_or_paused");
  });
});

test("atomic claim admits only one worker and stale lease generations cannot heartbeat or complete", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("lease-fence"));
    const taskId = created.body.task.taskId;
    const attempts = await Promise.all([
      call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:00:00.000Z" }),
      call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:00:00.000Z" }),
    ]);
    assert.equal(attempts.filter((item) => item.status === 200).length, 1);
    assert.equal(attempts.filter((item) => item.status === 409).length, 1);
    const lease = attempts.find((item) => item.status === 200).body.lease;

    const staleHeartbeat = await call(stub, "/heartbeat", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation + 1,
    });
    assert.equal(staleHeartbeat.status, 409);
    assert.equal(staleHeartbeat.body.error, "lease_fencing_conflict");

    const validHeartbeat = await call(stub, "/heartbeat", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation,
    }, { "x-test-now": "2026-11-19T10:01:00.000Z" });
    assert.equal(validHeartbeat.status, 200);
    assert.equal(validHeartbeat.body.task.leaseExpiresAt, Date.parse("2026-11-19T10:06:00.000Z"));

    const staleCompletion = await call(stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation + 1, status: "succeeded",
    }, { "x-test-now": "2026-11-19T10:02:00.000Z" });
    assert.equal(staleCompletion.status, 409);
    assert.equal(staleCompletion.body.error, "lease_fencing_conflict");

    const completed = await call(stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "succeeded",
      result: {
        taskType: "seo.audit",
        status: "attention",
        findingCount: 1,
        findings: [{ code: "seo_title_missing", severity: "error", message: "SEO title is missing." }],
      },
    }, { "x-test-now": "2026-11-19T10:02:00.000Z" });
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.task.state, "succeeded");
    assert.deepEqual(completed.body.task.result, {
      taskType: "seo.audit",
      status: "attention",
      findingCount: 1,
      findings: [{ code: "seo_title_missing", severity: "error", message: "SEO title is missing." }],
    });
    const persisted = await call(stub, "/task?id=" + encodeURIComponent(taskId));
    assert.equal(persisted.status, 200);
    assert.deepEqual(persisted.body.task.result, completed.body.task.result);
    assert.equal(completed.body.task.leaseExpiresAt, null);
    assert.equal(completed.body.task.leaseMaxExpiresAt, null);
    const duplicate = await call(stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "succeeded",
    }, { "x-test-now": "2026-11-19T10:03:00.000Z" });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);

    const conflictingDuplicate = await call(stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "succeeded",
      result: {
        taskType: "seo.audit", status: "pass", findingCount: 0, findings: [],
      },
    }, { "x-test-now": "2026-11-19T10:04:00.000Z" });
    assert.equal(conflictingDuplicate.status, 409);
    assert.equal(conflictingDuplicate.body.error, "completion_conflict");
    const unchanged = await call(stub, "/task?id=" + encodeURIComponent(taskId));
    assert.deepEqual(unchanged.body.task.result, completed.body.task.result,
      "a conflicting retry must not overwrite the original terminal result");
  });
});

test("concurrent conflicting completions serialize and preserve exactly one terminal result", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("parallel-completion-conflict"));
    const taskId = created.body.task.taskId;
    const claimed = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:00:00.000Z" });
    const lease = claimed.body.lease;
    const completion = (status) => call(stub, "/complete", {
      taskId,
      leaseOwner: lease.owner,
      leaseGeneration: lease.generation,
      status: "succeeded",
      result: {
        taskType: "seo.audit",
        status,
        findingCount: 0,
        findings: [],
      },
    }, { "x-test-now": "2026-11-19T10:01:00.000Z" });

    const results = await Promise.all([completion("pass"), completion("attention")]);
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
    const winner = results.find((item) => item.status === 200);
    const conflict = results.find((item) => item.status === 409);
    assert.equal(winner.body.task.state, "succeeded");
    assert.equal(conflict.body.error, "completion_conflict");

    const persisted = await call(stub, "/task?id=" + encodeURIComponent(taskId));
    assert.equal(persisted.status, 200);
    assert.deepEqual(persisted.body.task.result, winner.body.task.result,
      "the serialized winner must remain the only persisted terminal result");
  });
});

test("completion rejects malformed or oversized persisted review results", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("result-validation"));
    const taskId = created.body.task.taskId;
    const claimed = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:00:00.000Z" });
    const lease = claimed.body.lease;
    const invalid = await call(stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "succeeded",
      result: { taskType: "content.review", status: "pass", findingCount: 1, findings: [] },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "complete_result_invalid");
    const wrongStatus = await call(stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "failed",
      result: { taskType: "content.review", status: "pass", findingCount: 0, findings: [] },
    });
    assert.equal(wrongStatus.status, 400);
    assert.equal(wrongStatus.body.error, "complete_result_status_invalid");
    const oversized = await call(stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "succeeded",
      result: { taskType: "content.review", status: "attention", findingCount: 1, findings: [
        { code: "oversized_finding", severity: "warning", message: "x".repeat(5000) },
      ] },
    });
    assert.equal(oversized.status, 400);
    assert.equal(oversized.body.error, "complete_result_invalid");
  });
});

test("a worker from an expired lease cannot heartbeat or complete after the task is reclaimed", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("stale-worker-after-reclaim"));
    const taskId = created.body.task.taskId;
    const first = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:00:00.000Z" });
    assert.equal(first.status, 200);
    const staleLease = first.body.lease;

    const recovered = await call(stub, "/recover", {
      taskId, actor: "integration-test", requestId: crypto.randomUUID(),
    }, { "x-test-now": "2026-11-19T10:05:00.000Z" });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.outcome, "requeued");

    const reclaimed = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:05:30.000Z" });
    assert.equal(reclaimed.status, 200);
    const currentLease = reclaimed.body.lease;
    assert.equal(currentLease.generation, staleLease.generation + 1);
    assert.notEqual(currentLease.owner, staleLease.owner);

    const staleHeartbeat = await call(stub, "/heartbeat", {
      taskId, leaseOwner: staleLease.owner, leaseGeneration: staleLease.generation,
    }, { "x-test-now": "2026-11-19T10:06:00.000Z" });
    assert.equal(staleHeartbeat.status, 409);
    assert.equal(staleHeartbeat.body.error, "lease_fencing_conflict");

    const staleCompletion = await call(stub, "/complete", {
      taskId, leaseOwner: staleLease.owner, leaseGeneration: staleLease.generation, status: "succeeded",
    }, { "x-test-now": "2026-11-19T10:06:01.000Z" });
    assert.equal(staleCompletion.status, 409);
    assert.equal(staleCompletion.body.error, "lease_fencing_conflict");

    const stored = await call(stub, "/task?id=" + encodeURIComponent(taskId));
    assert.equal(stored.status, 200);
    assert.equal(stored.body.task.state, "running");
    assert.equal(stored.body.task.leaseGeneration, currentLease.generation);
    assert.equal(stored.body.task.leaseOwner, undefined);
    assert.equal(stored.body.task.attemptCount, 2);
  });
});

test("expired leases are requeued after bounded delay and fail at the attempt ceiling", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("lease-retry"));
    const taskId = created.body.task.taskId;
    const first = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:00:00.000Z" });
    assert.equal(first.status, 200);

    const tooEarly = await call(stub, "/recover", { taskId, actor: "integration-test", requestId: crypto.randomUUID() }, { "x-test-now": "2026-11-19T10:04:59.999Z" });
    assert.equal(tooEarly.status, 409);
    assert.equal(tooEarly.body.error, "lease_not_expired");

    const recovered1 = await call(stub, "/recover", { taskId, actor: "integration-test", requestId: crypto.randomUUID() }, { "x-test-now": "2026-11-19T10:05:00.000Z" });
    assert.equal(recovered1.status, 200);
    assert.equal(recovered1.body.outcome, "requeued");
    assert.equal(recovered1.body.task.state, "queued");
    assert.equal(recovered1.body.task.attemptCount, 1);
    assert.equal(recovered1.body.task.nextAttemptAt, Date.parse("2026-11-19T10:05:30.000Z"));
    assert.equal(recovered1.body.task.leaseMaxExpiresAt, null);

    const beforeDue = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:05:29.999Z" });
    assert.equal(beforeDue.status, 409);
    assert.equal(beforeDue.body.error, "retry_not_due");

    const second = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:05:30.000Z" });
    assert.equal(second.status, 200);
    const recovered2 = await call(stub, "/recover", { taskId, actor: "integration-test", requestId: crypto.randomUUID() }, { "x-test-now": "2026-11-19T10:10:30.000Z" });
    assert.equal(recovered2.status, 200);
    assert.equal(recovered2.body.outcome, "requeued");
    assert.equal(recovered2.body.task.nextAttemptAt, Date.parse("2026-11-19T10:12:30.000Z"));

    const beforeSecondRetryDue = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:12:29.999Z" });
    assert.equal(beforeSecondRetryDue.status, 409);
    assert.equal(beforeSecondRetryDue.body.error, "retry_not_due");

    const third = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:12:30.000Z" });
    assert.equal(third.status, 200);
    const exhausted = await call(stub, "/recover", { taskId, actor: "integration-test", requestId: crypto.randomUUID() }, { "x-test-now": "2026-11-19T10:17:30.000Z" });
    assert.equal(exhausted.status, 200);
    assert.equal(exhausted.body.outcome, "failed");
    assert.equal(exhausted.body.task.state, "failed");
    assert.equal(exhausted.body.task.errorCode, "lease_expired_max_attempts");
    assert.equal(exhausted.body.task.attemptCount, 3);
    assert.equal((await call(stub, "/usage")).body.inFlight, 0);
  });
});

test("five terminal failures open the circuit breaker and fence every in-flight lease", async () => {
  await withRuntime({}, async ({ stub }) => {
    const inFlight = await call(stub, "/reserve", task("circuit-breaker-in-flight"));
    assert.equal(inFlight.status, 201);
    const inFlightTaskId = inFlight.body.task.taskId;
    const inFlightClaim = await call(stub, "/claim", { taskId: inFlightTaskId });
    assert.equal(inFlightClaim.status, 200);
    const inFlightLease = inFlightClaim.body.lease;

    for (let index = 1; index <= 5; index++) {
      const created = await call(stub, "/reserve", task("circuit-breaker-" + index));
      assert.equal(created.status, 201);
      const taskId = created.body.task.taskId;
      const claimed = await call(stub, "/claim", { taskId });
      assert.equal(claimed.status, 200);
      const lease = claimed.body.lease;
      const failed = await call(stub, "/complete", {
        taskId,
        leaseOwner: lease.owner,
        leaseGeneration: lease.generation,
        status: "failed",
        errorCode: "simulated_failure",
      });
      assert.equal(failed.status, 200);
      const control = await call(stub, "/control");
      assert.equal(control.body.control.failureCountLast10m, index);
      assert.equal(control.body.control.paused, index === 5);
    }

    const blocked = await call(stub, "/reserve", task("circuit-breaker-blocked"));
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error, "agent_disabled_or_paused");
    const control = await call(stub, "/control");
    assert.equal(control.body.control.paused, true);
    assert.equal(control.body.control.circuitBreakerThreshold, 5);
    assert.equal(control.body.control.circuitBreakerWindowMs, 10 * 60 * 1000);

    const fenced = await call(stub, "/task?id=" + encodeURIComponent(inFlightTaskId));
    assert.equal(fenced.status, 200);
    assert.equal(fenced.body.task.state, "cancelled");
    assert.equal(fenced.body.task.errorCode, "circuit_breaker_paused");
    const lateHeartbeat = await call(stub, "/heartbeat", {
      taskId: inFlightTaskId,
      leaseOwner: inFlightLease.owner,
      leaseGeneration: inFlightLease.generation,
    });
    assert.equal(lateHeartbeat.status, 409);
    const lateCompletion = await call(stub, "/complete", {
      taskId: inFlightTaskId,
      leaseOwner: inFlightLease.owner,
      leaseGeneration: inFlightLease.generation,
      status: "succeeded",
    });
    assert.equal(lateCompletion.status, 409);
    assert.equal((await call(stub, "/usage")).body.inFlight, 0);

    const resumed = await call(stub, "/control/resume", {
      actor: "integration-test-resume",
      requestId: crypto.randomUUID(),
      reason: "verify cancelled work is never replayed automatically",
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.control.paused, false);

    const afterResume = await call(stub, "/task?id=" + encodeURIComponent(inFlightTaskId));
    assert.equal(afterResume.status, 200);
    assert.equal(afterResume.body.task.state, "cancelled");
    assert.equal(afterResume.body.task.errorCode, "circuit_breaker_paused");

    const sameIdempotencyKey = await call(stub, "/reserve", task("circuit-breaker-in-flight"));
    assert.equal(sameIdempotencyKey.status, 200);
    assert.equal(sameIdempotencyKey.body.duplicate, true);
    assert.equal(sameIdempotencyKey.body.task.state, "cancelled");

    const noAutomaticReclaim = await call(stub, "/claim", { taskId: inFlightTaskId });
    assert.equal(noAutomaticReclaim.status, 409);
  });
});

test("operator lease recovery is rate limited to ten requests per actor per minute", async () => {
  await withRuntime({}, async ({ stub }) => {
    const actor = "recovery-rate-test";
    const outcomes = [];
    for (let index = 0; index < 11; index++) {
      outcomes.push(await call(stub, "/recover", {
        taskId: "missing-task",
        actor,
        requestId: crypto.randomUUID(),
      }, { "x-test-now": "2026-11-19T10:00:00.000Z" }));
    }
    assert.ok(outcomes.slice(0, 10).every((item) => item.status === 404));
    assert.equal(outcomes[10].status, 429);
    assert.equal(outcomes[10].body.error, "runtime_control_rate_limited");
  });
});

test("pause blocks new claims and expiry recovery but allows safe heartbeat and completion", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-pause-lease-"));
  let active;
  let paused;
  try {
    active = await createRuntime({ persistDir: directory });
    const created = await call(active.stub, "/reserve", task("pause-lease"));
    const taskId = created.body.task.taskId;
    const claimed = await call(active.stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:00:00.000Z" });
    assert.equal(claimed.status, 200);
    const lease = claimed.body.lease;
    await active.mf.dispose();
    active = null;

    paused = await createRuntime({ persistDir: directory, enabled: "false", paused: "true" });
    assert.equal((await call(paused.stub, "/claim", { taskId })).status, 503);
    assert.equal((await call(paused.stub, "/recover", { taskId })).status, 503);

    const heartbeat = await call(paused.stub, "/heartbeat", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation,
    }, { "x-test-now": "2026-11-19T10:01:00.000Z" });
    assert.equal(heartbeat.status, 200);

    const completed = await call(paused.stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "succeeded",
    }, { "x-test-now": "2026-11-19T10:02:00.000Z" });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.task.state, "succeeded");
  } finally {
    if (active) await active.mf.dispose();
    if (paused) await paused.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});


test("State Store control mutation rejects oversized declared and chunked bodies before parsing", async () => {
  await withRuntime({}, async ({ stub }) => {
    const before = await call(stub, "/control");
    assert.equal(before.body.control.paused, false);

    const declaredTooLarge = await stub.fetch("http://do.local/control/pause", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TEST_STATE_STORE_TOKEN,
        "Content-Type": "application/json",
        "Content-Length": String(16 * 1024 + 1),
      },
      body: new Uint8Array(16 * 1024 + 1),
    });
    assert.equal(declaredTooLarge.status, 413);
    assert.equal((await declaredTooLarge.json()).error, "request_body_too_large");

    const chunkedTooLarge = await stub.fetch("http://do.local/control/pause", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TEST_STATE_STORE_TOKEN,
        "Content-Type": "application/json",
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(16 * 1024 + 1));
          controller.close();
        },
      }),
      duplex: "half",
    });
    assert.equal(chunkedTooLarge.status, 413);
    assert.equal((await chunkedTooLarge.json()).error, "request_body_too_large");

    const malformed = await stub.fetch("http://do.local/control/pause", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TEST_STATE_STORE_TOKEN,
        "Content-Type": "application/json",
      },
      body: "{invalid-json",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, "request_invalid");

    const duplicateField = await stub.fetch("http://do.local/control/pause", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TEST_STATE_STORE_TOKEN,
        "Content-Type": "application/json",
      },
      body: '{"reason":"first","reason":"second"}',
    });
    assert.equal(duplicateField.status, 400);
    assert.equal((await duplicateField.json()).error, "request_invalid");

    const duplicateInternalActor = await stub.fetch("http://do.local/control/pause", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TEST_STATE_STORE_TOKEN,
        "Content-Type": "application/json",
      },
      body: '{"actor":"first-actor","actor":"second-actor","requestId":"valid-request-1234","reason":"duplicate actor"}',
    });
    assert.equal(duplicateInternalActor.status, 400);
    assert.equal((await duplicateInternalActor.json()).error, "request_invalid");

    const after = await call(stub, "/control");
    assert.deepEqual(after.body.control, before.body.control);
  });
});


test("OIDC replay ledger consumes a jti once and rejects duplicate consumption", async () => {
  await withRuntime({}, async ({ stub }) => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const expiresAt = String(Math.floor((now + 5 * 60 * 1000) / 1000));
    const body = { jti: "github-actions-run-jti-000001", expiresAt };
    const first = await call(stub, "/oidc/replay/consume", body, { "x-test-now": new Date(now).toISOString() });
    const second = await call(stub, "/oidc/replay/consume", body, { "x-test-now": new Date(now).toISOString() });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { ok: true, consumed: true });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "oidc_token_replayed");
  });
});

test("OIDC replay ledger atomically rejects concurrent duplicate jti submissions", async () => {
  await withRuntime({}, async ({ stub }) => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const body = {
      jti: "github-actions-concurrent-jti-01",
      expiresAt: String(Math.floor((now + 5 * 60 * 1000) / 1000)),
    };
    const results = await Promise.all([
      call(stub, "/oidc/replay/consume", body, { "x-test-now": new Date(now).toISOString() }),
      call(stub, "/oidc/replay/consume", body, { "x-test-now": new Date(now).toISOString() }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  });
});

test("OIDC replay ledger rejects invalid, expired, excessive, and malformed jti inputs", async () => {
  await withRuntime({}, async ({ stub }) => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const headers = { "x-test-now": new Date(now).toISOString() };
    for (const body of [
      { jti: "short", expiresAt: String(Math.floor((now + 60_000) / 1000)) },
      { jti: "github-actions-invalid-expiry-001", expiresAt: String(Math.floor(now / 1000)) },
      { jti: "github-actions-too-far-expiry-01", expiresAt: String(Math.floor((now + 12 * 60 * 1000) / 1000)) },
      { jti: "github-actions-missing-expiry-01" },
      { jti: "github-actions-extra-field-0001", expiresAt: String(Math.floor((now + 60_000) / 1000)), actor: "spoofed" },
    ]) {
      const result = await call(stub, "/oidc/replay/consume", body, headers);
      assert.equal(result.status, 400);
    }
  });
});

test("OIDC replay ledger persists across State Store restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-oidc-replay-"));
  let first;
  let second;
  try {
    first = await createRuntime({ persistDir: directory });
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const body = {
      jti: "github-actions-persisted-jti-01",
      expiresAt: String(Math.floor((now + 5 * 60 * 1000) / 1000)),
    };
    const consumed = await call(first.stub, "/oidc/replay/consume", body, { "x-test-now": new Date(now).toISOString() });
    assert.equal(consumed.status, 200);
    await first.mf.dispose();
    first = null;

    second = await createRuntime({ persistDir: directory });
    const replay = await call(second.stub, "/oidc/replay/consume", body, { "x-test-now": new Date(now).toISOString() });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error, "oidc_token_replayed");
  } finally {
    if (first) await first.mf.dispose();
    if (second) await second.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("OIDC replay ledger prunes expired entries and permits a later fresh token identifier", async () => {
  await withRuntime({}, async ({ stub }) => {
    const firstNow = Date.parse("2026-11-19T10:00:00.000Z");
    const firstExpiry = String(Math.floor((firstNow + 60_000) / 1000));
    const jti = "github-actions-recycled-jti-0001";
    const first = await call(stub, "/oidc/replay/consume", { jti, expiresAt: firstExpiry }, {
      "x-test-now": new Date(firstNow).toISOString(),
    });
    assert.equal(first.status, 200);

    const laterNow = firstNow + 25 * 60 * 60 * 1000;
    const laterExpiry = String(Math.floor((laterNow + 60_000) / 1000));
    const later = await call(stub, "/oidc/replay/consume", { jti, expiresAt: laterExpiry }, {
      "x-test-now": new Date(laterNow).toISOString(),
    });
    assert.equal(later.status, 200);
  });
});


test("all six task mutation routes reject streamed request bodies above the 16 KiB ingress cap", async () => {
  await withRuntime({}, async ({ stub }) => {
    const oversized = " ".repeat(16 * 1024 + 1);
    for (const pathname of ["/reserve", "/claim", "/heartbeat", "/complete", "/recover", "/transition"]) {
      const response = await stub.fetch("http://do.local" + pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + TEST_STATE_STORE_TOKEN },
        body: oversized,
      });
      assert.equal(response.status, 413, pathname);
      assert.equal((await response.json()).error, "request_body_too_large", pathname);
    }
  });
});

test("claim accepts a valid JSON request exactly at the 16 KiB ingress limit", async () => {
  await withRuntime({}, async ({ stub }) => {
    const prefix = JSON.stringify({ taskId: "missing" });
    const body = prefix + " ".repeat(16 * 1024 - new TextEncoder().encode(prefix).byteLength);
    assert.equal(new TextEncoder().encode(body).byteLength, 16 * 1024);
    const response = await stub.fetch("http://do.local/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(16 * 1024), Authorization: "Bearer " + TEST_STATE_STORE_TOKEN },
      body,
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "task_not_found");
  });
});


test("all six task mutation routes reject non-JSON media types before mutation", async () => {
  await withRuntime({}, async ({ stub }) => {
    for (const pathname of ["/reserve", "/claim", "/heartbeat", "/complete", "/recover", "/transition"]) {
      const response = await stub.fetch("http://do.local" + pathname, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Authorization: "Bearer " + TEST_STATE_STORE_TOKEN },
        body: "{}",
      });
      assert.equal(response.status, 400, pathname);
      assert.equal((await response.json()).error, "request_invalid", pathname);
    }
  });
});


test("outbound request budgets enforce daily per-scope caps and reset on the next UTC day", async () => {
  await withRuntime({}, async ({ stub }) => {
    const day = "2026-11-21";
    const executionHeaders = { "x-test-now": "2026-11-21T12:00:00.000Z" };
    for (let index = 1; index <= 10; index += 1) {
      const consumed = await call(stub, "/external-budget/consume", { day, scope: "ai_bank_discovery" }, executionHeaders);
      assert.equal(consumed.status, 200);
      assert.equal(consumed.body.budget.allowed, true);
      assert.equal(consumed.body.budget.used, index);
      assert.equal(consumed.body.budget.limit, 10);
    }
    const exhausted = await call(stub, "/external-budget/consume", { day, scope: "ai_bank_discovery" }, executionHeaders);
    assert.equal(exhausted.status, 200);
    assert.equal(exhausted.body.budget.allowed, false);
    assert.equal(exhausted.body.budget.remaining, 0);

    const read = await call(stub, `/external-budget?day=${day}&scope=ai_bank_discovery`);
    assert.equal(read.status, 200);
    assert.equal(read.body.budget.used, 10);
    assert.equal(read.body.budget.remaining, 0);

    const nextDay = await call(stub, "/external-budget/consume", { day: "2026-11-22", scope: "ai_bank_discovery" }, {
      "x-test-now": "2026-11-22T00:00:01.000Z"
    });
    assert.equal(nextDay.body.budget.allowed, true);
    assert.equal(nextDay.body.budget.used, 1);
  });
});

test("content research has its own eight-request daily budget and invalid scopes/dates fail closed", async () => {
  await withRuntime({}, async ({ stub }) => {
    const executionHeaders = { "x-test-now": "2026-11-21T12:00:00.000Z" };
    for (let index = 1; index <= 8; index += 1) {
      const result = await call(stub, "/external-budget/consume", { day: "2026-11-21", scope: "content_research" }, executionHeaders);
      assert.equal(result.status, 200);
      assert.equal(result.body.budget.allowed, true);
      assert.equal(result.body.budget.used, index);
    }
    const exhausted = await call(stub, "/external-budget/consume", { day: "2026-11-21", scope: "content_research" }, executionHeaders);
    assert.equal(exhausted.body.budget.allowed, false);
    assert.equal(exhausted.body.budget.limit, 8);

    for (const body of [
      { day: "2026-02-30", scope: "ai_bank_discovery" },
      { day: "2026-11-21", scope: "unknown_scope" },
    ]) {
      const invalid = await call(stub, "/external-budget/consume", body, executionHeaders);
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error, "external_request_budget_input_invalid");
    }
    const missing = await call(stub, "/external-budget?scope=content_research");
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, "external_request_budget_input_invalid");
  });
});

test("outbound request budget rejects delayed and future UTC day keys at execution time", async () => {
  await withRuntime({}, async ({ stub }) => {
    const executionHeaders = { "x-test-now": "2026-11-22T00:15:00.000Z" };
    const delayed = await call(stub, "/external-budget/consume", {
      day: "2026-11-21",
      scope: "ai_bank_discovery",
    }, executionHeaders);
    assert.equal(delayed.status, 400);
    assert.equal(delayed.body.error, "external_request_budget_day_mismatch");

    const future = await call(stub, "/external-budget/consume", {
      day: "2026-11-23",
      scope: "ai_bank_discovery",
    }, executionHeaders);
    assert.equal(future.status, 400);
    assert.equal(future.body.error, "external_request_budget_day_mismatch");

    const current = await call(stub, "/external-budget/consume", {
      day: "2026-11-22",
      scope: "ai_bank_discovery",
    }, executionHeaders);
    assert.equal(current.status, 200);
    assert.equal(current.body.budget.allowed, true);
    assert.equal(current.body.budget.day, "2026-11-22");
  });
});

test("State Store retention cleanup removes at most 100 rows per table per invocation", async () => {
  await withRuntime({}, async ({ stub }) => {
    const now = Date.parse("2026-11-21T12:00:00.000Z");
    const seeded = await call(stub, "/__test/seed-prune-fixture", { now });
    assert.equal(seeded.status, 200);
    assert.equal(seeded.body.seeded, 101);

    const first = await call(stub, "/__test/prune", { now });
    assert.equal(first.status, 200);
    const afterFirst = await call(stub, "/__test/prune-counts");
    assert.deepEqual(afterFirst.body.counts, {
      tasks: 1,
      auditEvents: 1,
      controlAudit: 1,
      rateLimits: 1,
      dailyUsage: 1,
      externalBudgets: 1,
    });

    const second = await call(stub, "/__test/prune", { now });
    assert.equal(second.status, 200);
    const afterSecond = await call(stub, "/__test/prune-counts");
    assert.deepEqual(afterSecond.body.counts, {
      tasks: 0,
      auditEvents: 0,
      controlAudit: 0,
      rateLimits: 0,
      dailyUsage: 0,
      externalBudgets: 0,
    });
  });
});

test("outbound budget rows are pruned after the 30-day retention window", async () => {
  await withRuntime({}, async ({ stub }) => {
    const oldDay = "2026-10-01";
    const inserted = await call(stub, "/external-budget/consume", { day: oldDay, scope: "ai_bank_discovery" }, { "x-test-now": "2026-10-01T12:00:00.000Z" });
    assert.equal(inserted.body.budget.used, 1);
    const pruned = await call(stub, "/__test/prune", { now: Date.parse("2026-11-21T12:00:00.000Z") });
    assert.equal(pruned.status, 200);
    const after = await call(stub, `/external-budget?day=${oldDay}&scope=ai_bank_discovery`);
    assert.equal(after.status, 200);
    assert.equal(after.body.budget.used, 0);
  });
});


test("all seven task mutation routes reject streamed bodies above the 16 KiB ingress cap", async () => {
  await withRuntime({}, async ({ stub }) => {
    const oversized = " ".repeat(16 * 1024 + 1);
    for (const pathname of ["/reserve", "/claim", "/claim-next", "/heartbeat", "/complete", "/recover", "/transition"]) {
      const response = await stub.fetch("http://do.local" + pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + TEST_STATE_STORE_TOKEN },
        body: oversized,
      });
      assert.equal(response.status, 413, pathname);
      assert.equal((await response.json()).error, "request_body_too_large", pathname);
    }
  });
});

test("all seven task mutation routes reject non-JSON media types before mutation", async () => {
  await withRuntime({}, async ({ stub }) => {
    for (const pathname of ["/reserve", "/claim", "/claim-next", "/heartbeat", "/complete", "/recover", "/transition"]) {
      const response = await stub.fetch("http://do.local" + pathname, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Authorization: "Bearer " + TEST_STATE_STORE_TOKEN },
        body: "{}",
      });
      assert.equal(response.status, 400, pathname);
      assert.equal((await response.json()).error, "request_invalid", pathname);
    }
  });
});
