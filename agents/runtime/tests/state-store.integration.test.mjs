import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "fixtures/state-store-test-worker.mjs");
const productionWorkerPath = path.resolve(here, "../src/worker.mjs");
const TEST_OPERATOR_TOKEN = "integration-test-operator-token-0123456789abcdef";
const TEST_STATE_STORE_TOKEN = "integration-test-state-store-token-0123456789abcdef";

async function createRuntime({ daily = 100, concurrent = 5, persistDir, enabled = "true", paused = "false", resumeControl = true } = {}) {
  const directory = persistDir ?? await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-"));
  const mf = new Miniflare({
    modules: true,
    scriptPath: workerPath,
    // Keep the local simulator date within the pinned workerd build (supports through 2026-07-08).
    // This is test-harness-only; the isolated Preview Worker date remains in wrangler.jsonc.
    compatibilityDate: "2026-07-08",
    durableObjects: { AGENT_STATE_STORE: { className: "AgentStateStore", useSQLite: true } },
    durableObjectsPersist: directory,
    bindings: {
      AGENT_ENABLED: enabled,
      AGENT_PAUSED: paused,
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
function recoveryBody(taskId, actor = "test-operator") {
  return { taskId, actor, requestId: crypto.randomUUID() };
}
async function call(stub, pathname, body, headers = {}) {
  const response = await stub.fetch("http://do.local" + pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: "Bearer " + TEST_STATE_STORE_TOKEN, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test("deployable Worker State Store has no test routes or test clock override", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-production-boundary-"));
  const mf = new Miniflare({
    modules: true,
    scriptPath: productionWorkerPath,
    compatibilityDate: "2026-07-08",
    durableObjects: { AGENT_STATE_STORE: { className: "AgentStateStore", useSQLite: true } },
    durableObjectsPersist: directory,
    bindings: {
      AGENT_ENABLED: "true",
      AGENT_PAUSED: "false",
      AGENT_OPERATOR_TOKEN: TEST_OPERATOR_TOKEN,
      AGENT_STATE_STORE_TOKEN: TEST_STATE_STORE_TOKEN,
    },
  });
  try {
    const namespace = await mf.getDurableObjectNamespace("AGENT_STATE_STORE");
    const stub = namespace.get(namespace.idFromName("agent-runtime-production-boundary"));
    const opened = await call(stub, "/control/resume", {
      actor: "integration-test",
      requestId: crypto.randomUUID(),
      reason: "production boundary test",
    });
    assert.equal(opened.status, 200);

    const rollback = await call(stub, "/__test/rollback", {});
    assert.equal(rollback.status, 404);
    assert.equal(rollback.body.error, "not_found");

    const created = await call(stub, "/reserve", task("production-clock"), {
      "x-test-now": "2000-01-01T00:00:00.000Z",
    });
    assert.equal(created.status, 201);
    assert.ok(created.body.task.createdAt > Date.parse("2020-01-01T00:00:00.000Z"));
  } finally {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("all state-store routes require the distinct internal credential", async () => {
  await withRuntime({}, async ({ stub }) => {
    for (const [pathname, body] of [
      ["/reserve", task("unauth-reserve")],
      ["/claim", { taskId: "missing" }],
      ["/heartbeat", { taskId: "missing", leaseOwner: "a1b2c3d4-e5f6-4711-8123-abcdef012345", leaseGeneration: 1 }],
      ["/complete", { taskId: "missing", leaseOwner: "a1b2c3d4-e5f6-4711-8123-abcdef012345", leaseGeneration: 1, status: "succeeded" }],
      ["/recover", recoveryBody("missing")],
      ["/transition", { taskId: "missing", status: "running" }],
      ["/control", undefined],
      ["/oidc/replay/consume", { jti: "test-jti-auth-check-001", expiresAt: "1799999999" }],
      ["/control/pause", {}],
      ["/control/resume", {}],
      ["/task?id=missing", undefined],
      ["/usage", undefined],
      ["/metrics", undefined],
      ["/__test/rollback", {}],
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

test("state-store admission fails closed while disabled or paused", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-do-paused-"));
  const mf = new Miniflare({
    modules: true,
    scriptPath: workerPath,
    compatibilityDate: "2026-07-08",
    durableObjects: { AGENT_STATE_STORE: { className: "AgentStateStore", useSQLite: true } },
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

test("persisted v1 State Store migrates transactionally to v5 without losing task or usage", async () => {
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
    assert.equal(usage.body.acceptedToday, 1);
    assert.equal(usage.body.inFlight, 1);
  } finally {
    if (first) await first.mf.dispose();
    if (second) await second.mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
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
    }, { "x-test-now": "2026-11-19T10:02:00.000Z" });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.task.state, "succeeded");
    assert.equal(completed.body.task.leaseExpiresAt, null);
    assert.equal(completed.body.task.leaseMaxExpiresAt, null);
    const duplicate = await call(stub, "/complete", {
      taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "succeeded",
    }, { "x-test-now": "2026-11-19T10:03:00.000Z" });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
  });
});

test("expired leases are requeued after bounded delay and fail at the attempt ceiling", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("lease-retry"));
    const taskId = created.body.task.taskId;
    const first = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:00:00.000Z" });
    assert.equal(first.status, 200);

    const tooEarly = await call(stub, "/recover", recoveryBody(taskId), { "x-test-now": "2026-11-19T10:04:59.999Z" });
    assert.equal(tooEarly.status, 409);
    assert.equal(tooEarly.body.error, "lease_not_expired");

    const recoveryRequest = recoveryBody(taskId);
    const recovered1 = await call(stub, "/recover", recoveryRequest, { "x-test-now": "2026-11-19T10:05:00.000Z" });
    assert.equal(recovered1.status, 200);
    assert.equal(recovered1.body.outcome, "requeued");
    assert.equal(recovered1.body.task.state, "queued");
    assert.equal(recovered1.body.task.attemptCount, 1);
    assert.equal(recovered1.body.task.nextAttemptAt, Date.parse("2026-11-19T10:05:30.000Z"));
    assert.equal(recovered1.body.task.leaseMaxExpiresAt, null);

    const audit = await call(stub, "/__test/audit?taskId=" + encodeURIComponent(taskId));
    assert.equal(audit.status, 200);
    const recoveryEvent = audit.body.events.find((event) => event.eventType === "task.lease_expired_requeued");
    assert.ok(recoveryEvent);
    assert.equal(recoveryEvent.metadata.actor, recoveryRequest.actor);
    assert.equal(recoveryEvent.metadata.requestId, recoveryRequest.requestId);
    assert.equal(recoveryEvent.metadata.attempt, 1);
    assert.equal(recoveryEvent.metadata.leaseGeneration, 1);

    const beforeDue = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:05:29.999Z" });
    assert.equal(beforeDue.status, 409);
    assert.equal(beforeDue.body.error, "retry_not_due");

    const second = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:05:30.000Z" });
    assert.equal(second.status, 200);
    const recovered2 = await call(stub, "/recover", recoveryBody(taskId), { "x-test-now": "2026-11-19T10:10:30.000Z" });
    assert.equal(recovered2.status, 200);
    assert.equal(recovered2.body.outcome, "requeued");

    const third = await call(stub, "/claim", { taskId }, { "x-test-now": "2026-11-19T10:11:00.000Z" });
    assert.equal(third.status, 200);
    const exhausted = await call(stub, "/recover", recoveryBody(taskId), { "x-test-now": "2026-11-19T10:16:00.000Z" });
    assert.equal(exhausted.status, 200);
    assert.equal(exhausted.body.outcome, "failed");
    assert.equal(exhausted.body.task.state, "failed");
    assert.equal(exhausted.body.task.errorCode, "lease_expired_max_attempts");
    assert.equal(exhausted.body.task.attemptCount, 3);
    assert.equal((await call(stub, "/usage")).body.inFlight, 0);
  });
});

test("dead-letter inspection returns bounded failed-task metadata with stable cursor pagination", async () => {
  await withRuntime({}, async ({ stub }) => {
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
      const third = await call(stub, "/claim", { taskId }, { "x-test-now": new Date(start + 11 * 60_000).toISOString() });
      assert.equal(third.status, 200);
      const failed = await call(stub, "/recover", recoveryBody(taskId), { "x-test-now": new Date(start + 16 * 60_000).toISOString() });
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

test("task recovery requires actor identity and applies a durable per-operator rate limit", async () => {
  await withRuntime({}, async ({ stub }) => {
    assert.equal((await call(stub, "/recover", { taskId: "missing", requestId: crypto.randomUUID() })).status, 400);
    assert.equal((await call(stub, "/recover", { ...recoveryBody("missing"), actor: "bad actor" })).status, 400);
    for (let index = 0; index < 10; index += 1) {
      const missing = await call(stub, "/recover", recoveryBody("missing"));
      assert.equal(missing.status, 404);
    }
    const limited = await call(stub, "/recover", recoveryBody("missing"));
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, "runtime_control_rate_limited");
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
    assert.equal((await call(paused.stub, "/recover", recoveryBody(taskId))).status, 503);

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

test("retention cleanup deletes bounded oldest-first batches and preserves active or recent tasks", async () => {
  await withRuntime({}, async ({ stub }) => {
    const now = Date.parse("2026-11-20T12:00:00.000Z");
    const headers = { "x-test-now": new Date(now).toISOString() };
    const seeded = await call(stub, "/__test/seed-retention", {}, headers);
    assert.equal(seeded.status, 200);
    assert.deepEqual(seeded.body.seeded, {
      expiredTasks: 105,
      expiredAuditEvents: 305,
      expiredControlAudit: 105,
      expiredRateLimits: 105,
      expiredDailyUsage: 105,
    });

    const before = await call(stub, "/__test/retention-counts", undefined, headers);
    assert.equal(before.body.expiredTasks, 105);
    assert.equal(before.body.expiredAuditEvents, 305);
    assert.equal(before.body.expiredControlAudit, 105);
    assert.equal(before.body.expiredRateLimits, 105);
    assert.equal(before.body.expiredDailyUsage, 105);

    const firstAdmission = await call(stub, "/reserve", task("retention-trigger-first"), headers);
    assert.equal(firstAdmission.status, 201);
    const afterFirst = await call(stub, "/__test/retention-counts", undefined, headers);
    assert.equal(afterFirst.body.expiredTasks, 5, "only 100 expired tasks are removed per pass");
    assert.equal(afterFirst.body.expiredAuditEvents, 55, "only 250 expired audit events are removed per pass");
    assert.equal(afterFirst.body.expiredControlAudit, 5);
    assert.equal(afterFirst.body.expiredRateLimits, 5);
    assert.equal(afterFirst.body.expiredDailyUsage, 5);
    assert.equal(afterFirst.body.runningTasks, 1, "running tasks are never eligible for retention deletion");
    assert.equal(afterFirst.body.recentTerminalTasks, 1, "recent terminal tasks are retained");

    const secondAdmission = await call(stub, "/reserve", task("retention-trigger-second"), headers);
    assert.equal(secondAdmission.status, 201);
    const afterSecond = await call(stub, "/__test/retention-counts", undefined, headers);
    assert.equal(afterSecond.body.expiredTasks, 0);
    assert.equal(afterSecond.body.expiredAuditEvents, 0);
    assert.equal(afterSecond.body.expiredControlAudit, 0);
    assert.equal(afterSecond.body.expiredRateLimits, 0);
    assert.equal(afterSecond.body.expiredDailyUsage, 0);
    assert.equal(afterSecond.body.runningTasks, 1);
    assert.equal(afterSecond.body.recentTerminalTasks, 1);
  });
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


test("State Store bounds every mutating POST body before initialization or SQL writes", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("bounded-request-seed"));
    assert.equal(created.status, 201);
    const taskId = created.body.task.taskId;
    const claimed = await call(stub, "/claim", { taskId });
    assert.equal(claimed.status, 200);
    const lease = claimed.body.lease;

    const routes = [
      ["/control/pause", { actor: "integration-test", requestId: crypto.randomUUID(), reason: "oversize probe" }, 16 * 1024],
      ["/control/resume", { actor: "integration-test", requestId: crypto.randomUUID(), reason: "oversize probe" }, 16 * 1024],
      ["/reserve", task("bounded-request-overflow"), 12 * 1024],
      ["/claim", { taskId }, 12 * 1024],
      ["/heartbeat", { taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation }, 12 * 1024],
      ["/complete", { taskId, leaseOwner: lease.owner, leaseGeneration: lease.generation, status: "succeeded" }, 12 * 1024],
      ["/recover", recoveryBody(taskId), 12 * 1024],
      ["/transition", { taskId, status: "succeeded" }, 12 * 1024],
      ["/oidc/replay/consume", { jti: "github-actions-bounded-body-01", expiresAt: "1799999999" }, 1024],
    ];

    const before = {
      usage: (await call(stub, "/usage")).body,
      task: (await call(stub, "/task?id=" + encodeURIComponent(taskId))).body.task,
      control: (await call(stub, "/control")).body.control,
    };

    for (const [pathname, payload, limit] of routes) {
      const oversized = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...payload, padding: "x".repeat(limit + 64) })));
          controller.close();
        },
      });
      const response = await stub.fetch("http://do.local" + pathname, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + TEST_STATE_STORE_TOKEN,
          "Content-Type": "application/json",
        },
        body: oversized,
        duplex: "half",
      });
      assert.equal(response.status, 413, pathname + " streamed body must be rejected");
      assert.equal((await response.json()).error, "request_body_too_large", pathname);
    }

    const declaredTooLarge = await stub.fetch("http://do.local/reserve", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + TEST_STATE_STORE_TOKEN,
        "Content-Type": "application/json",
        "Content-Length": String(12 * 1024 + 1),
      },
      body: new Uint8Array(12 * 1024 + 1),
    });
    assert.equal(declaredTooLarge.status, 413);

    const malformed = await stub.fetch("http://do.local/claim", {
      method: "POST",
      headers: { Authorization: "Bearer " + TEST_STATE_STORE_TOKEN, "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, "request_invalid");

    const invalidUtf8 = await stub.fetch("http://do.local/heartbeat", {
      method: "POST",
      headers: { Authorization: "Bearer " + TEST_STATE_STORE_TOKEN, "Content-Type": "application/json" },
      body: new Uint8Array([0xc3, 0x28]),
    });
    assert.equal(invalidUtf8.status, 400);

    const empty = await stub.fetch("http://do.local/complete", {
      method: "POST",
      headers: { Authorization: "Bearer " + TEST_STATE_STORE_TOKEN, "Content-Type": "application/json" },
    });
    assert.equal(empty.status, 400);

    const after = {
      usage: (await call(stub, "/usage")).body,
      task: (await call(stub, "/task?id=" + encodeURIComponent(taskId))).body.task,
      control: (await call(stub, "/control")).body.control,
    };
    assert.deepEqual(after, before, "rejected requests must not change task, quota, or control state");
  });
});
