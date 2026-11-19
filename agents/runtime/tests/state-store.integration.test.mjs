import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "../src/worker.mjs");
const TEST_OPERATOR_TOKEN = "integration-test-operator-token-0123456789abcdef";

async function createRuntime({ daily = 100, concurrent = 5, persistDir, enabled = "true", paused = "false" } = {}) {
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
      RUNTIME_TESTING: "true",
      AGENT_ENABLED: enabled,
      AGENT_PAUSED: paused,
      AGENT_OPERATOR_TOKEN: TEST_OPERATOR_TOKEN,
      RUNTIME_MAX_TASKS_PER_DAY: String(daily),
      RUNTIME_MAX_CONCURRENT_TASKS: String(concurrent),
    },
  });
  const namespace = await mf.getDurableObjectNamespace("AGENT_STATE_STORE");
  const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
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
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: "Bearer " + TEST_OPERATOR_TOKEN, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test("all state-store routes reject missing or invalid operator authentication", async () => {
  await withRuntime({}, async ({ stub }) => {
    for (const [pathname, body] of [
      ["/reserve", task("unauth-reserve")],
      ["/transition", { taskId: "missing", status: "running" }],
      ["/task?id=missing", undefined],
      ["/usage", undefined],
      ["/__test/rollback", {}],
    ]) {
      const missing = await call(stub, pathname, body, { Authorization: "" });
      const invalid = await call(stub, pathname, body, { Authorization: "Bearer invalid-token" });
      assert.equal(missing.status, 401, pathname + " missing token");
      assert.equal(invalid.status, 401, pathname + " invalid token");
      assert.equal(missing.body.error, "operator_auth_required");
      assert.equal(invalid.body.error, "operator_auth_required");
    }
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
    bindings: { RUNTIME_TESTING: "true", AGENT_OPERATOR_TOKEN: TEST_OPERATOR_TOKEN, AGENT_ENABLED: "false", AGENT_PAUSED: "true" },
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
    assert.equal((await call(stub, "/transition", { taskId, status: "running" })).status, 200);
    assert.equal((await call(stub, "/transition", { taskId, status: "succeeded" })).status, 200);
    const repeated = await call(stub, "/transition", { taskId, status: "succeeded" });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.duplicate, true);
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
    assert.equal((await call(stub, "/transition", { taskId, status: "running" })).status, 200);
    assert.equal((await call(stub, "/transition", { taskId, status: "failed", errorCode: "review_failed" })).status, 200);
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


test("fresh State Store initializes schema v2 with conservative lease defaults", async () => {
  await withRuntime({}, async ({ stub }) => {
    const created = await call(stub, "/reserve", task("schema-v2-fresh"));
    assert.equal(created.status, 201);
    assert.equal(created.body.task.attemptCount, 0);
    assert.equal(created.body.task.maxAttempts, 3);
    assert.equal(created.body.task.leaseGeneration, 0);
    assert.equal(created.body.task.leaseExpiresAt, null);
    assert.equal(created.body.task.nextAttemptAt, null);
    assert.equal(created.body.task.lastErrorCode, null);
  });
});

test("persisted v1 State Store migrates transactionally to v2 without losing task or usage", async () => {
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
