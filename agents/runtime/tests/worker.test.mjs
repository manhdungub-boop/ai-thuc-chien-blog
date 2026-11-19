import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const request = (path, method = "GET") =>
  new Request("https://agent-runtime-preview.example.workers.dev" + path, { method });

test("health is read-only and reports the default closed state", async () => {
  const response = await worker.fetch(request("/health"), {
    AGENT_ENABLED: "false",
    AGENT_PAUSED: "true",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.enabled, false);
  assert.equal(body.paused, true);
  assert.equal(body.execution, "not_implemented");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("run is rejected while disabled", async () => {
  const response = await worker.fetch(request("/run", "POST"), {
    AGENT_ENABLED: "false",
    AGENT_PAUSED: "true",
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "agent_disabled_or_paused");
});

test("run remains unavailable after flags and operator authentication are opened", async () => {
  const token = "preview-only-test-secret-0123456789abcdef";
  const authorizedRequest = new Request("https://agent-runtime-preview.example.workers.dev/run", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });
  const response = await worker.fetch(authorizedRequest, {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: token,
  });
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error, "execution_not_implemented");
});

test("health rejects non-GET methods", async () => {
  const response = await worker.fetch(request("/health", "POST"), {});
  assert.equal(response.status, 405);
});

test("unknown routes do not expose runtime internals", async () => {
  const response = await worker.fetch(request("/admin"), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "not_found");
});

test("run requires operator authentication if both safety flags are opened", async () => {
  const response = await worker.fetch(request("/run", "POST"), {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "operator_auth_required");
});

test("run remains unimplemented after valid operator authentication", async () => {
  const token = "preview-only-test-secret-0123456789abcdef";
  const authorizedRequest = new Request("https://agent-runtime-preview.example.workers.dev/run", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });
  const response = await worker.fetch(authorizedRequest, {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: token,
  });
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error, "execution_not_implemented");
});


const OPERATOR_TOKEN = "worker-bridge-operator-token-0123456789abcdef";
const STATE_TOKEN = "worker-bridge-state-store-token-0123456789abcdef";
function bridgeEnv({ responseBody = { ok: true, dayUtc: "2026-11-19", acceptedToday: 2, inFlight: 1 } } = {}) {
  const calls = [];
  const stub = {
    async fetch(internalRequest) {
      calls.push(internalRequest);
      return Response.json(responseBody);
    },
  };
  const env = {
    AGENT_OPERATOR_TOKEN: OPERATOR_TOKEN,
    AGENT_OPERATOR_ID: "project-operator-01",
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_STATE_STORE_TOKEN: STATE_TOKEN,
    AGENT_STATE_STORE: {
      idFromName(name) {
        assert.equal(name, "agent-runtime-global");
        return "fixed-object-id";
      },
      get(id) {
        assert.equal(id, "fixed-object-id");
        return stub;
      },
    },
  };
  return { env, calls };
}

test("read-only usage bridge requires operator auth and the internal binding", async () => {
  const unauthorized = await worker.fetch(request("/internal/usage"), {});
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, "operator_auth_required");

  const token = OPERATOR_TOKEN;
  const authorized = new Request("https://agent-runtime-preview.example.workers.dev/internal/usage", {
    headers: { Authorization: "Bearer " + token },
  });
  const missingBinding = await worker.fetch(authorized, {
    AGENT_OPERATOR_TOKEN: token,
    AGENT_STATE_STORE_TOKEN: STATE_TOKEN,
  });
  assert.equal(missingBinding.status, 503);
  assert.equal((await missingBinding.json()).error, "state_store_unavailable");
});

test("usage bridge uses fixed DO identity and sends only the dedicated internal credential", async () => {
  const { env, calls } = bridgeEnv();
  const incoming = new Request("https://agent-runtime-preview.example.workers.dev/internal/usage", {
    headers: {
      Authorization: "Bearer " + OPERATOR_TOKEN,
      Cookie: "session=must-not-forward",
      Origin: "https://untrusted.example",
      "X-Arbitrary": "must-not-forward",
    },
  });
  const response = await worker.fetch(incoming, env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.acceptedToday, 2);
  assert.equal(body.inFlight, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://state-store.internal/usage");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.get("authorization"), "Bearer " + STATE_TOKEN);
  assert.equal(calls[0].headers.get("cookie"), null);
  assert.equal(calls[0].headers.get("origin"), null);
  assert.equal(calls[0].headers.get("x-arbitrary"), null);
  assert.equal(JSON.stringify(body).includes(STATE_TOKEN), false);
});

test("read-only metrics bridge authenticates, uses a fixed route, and returns only aggregate fields", async () => {
  const responseBody = {
    ok: true,
    observedAt: 1799999999000,
    dayUtc: "2026-11-20",
    tasks: { totalRetained: 7, queued: 2, queuedDue: 1, running: 1, succeededRetained: 3, failedRetained: 1, cancelledRetained: 0, failedLast24h: 1, oldestQueuedAgeMs: 1200, oldestRunningUpdateAgeMs: 900, taskIds: ["private-task"] },
    quota: { acceptedToday: 7, dailyLimit: 100, dailyUtilizationPercent: 7, inFlight: 3, concurrentLimit: 5, concurrentUtilizationPercent: 60, payloadLimitBytes: 8192 },
    auditLast24h: [{ eventType: "task.failed", count: 1 }],
    note: "Internal admission guardrails only; not a measurement of provider or Cloudflare account quota.",
  };
  const { env, calls } = bridgeEnv({ responseBody });
  const incoming = new Request("https://agent-runtime-preview.example.workers.dev/internal/metrics", {
    headers: {
      Authorization: "Bearer " + OPERATOR_TOKEN,
      Cookie: "session=must-not-forward",
      "X-Arbitrary": "must-not-forward",
    },
  });
  const response = await worker.fetch(incoming, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.tasks.queuedDue, 1);
  assert.equal(body.quota.dailyUtilizationPercent, 7);
  assert.equal(body.auditLast24h[0].eventType, "task.failed");
  assert.equal("taskIds" in body.tasks, false);
  assert.equal(JSON.stringify(body).includes("private-task"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://state-store.internal/metrics");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.get("authorization"), "Bearer " + STATE_TOKEN);
  assert.equal(calls[0].headers.get("cookie"), null);
  assert.equal(calls[0].headers.get("x-arbitrary"), null);
  assert.equal(JSON.stringify(body).includes(STATE_TOKEN), false);
});

test("metrics bridge rejects unauthenticated requests, query strings, and malformed State Store responses", async () => {
  const unauthorized = await worker.fetch(request("/internal/metrics"), {});
  assert.equal(unauthorized.status, 401);
  const { env, calls } = bridgeEnv();
  const query = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/metrics?day=2026-11-20", {
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN },
  }), env);
  assert.equal(query.status, 400);
  assert.equal(calls.length, 0);

  const malformedEnv = bridgeEnv({ responseBody: { ok: true, tasks: {}, quota: {}, auditLast24h: "not-an-array", observedAt: "invalid", note: "x" } }).env;
  const malformed = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/metrics", {
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN },
  }), malformedEnv);
  assert.equal(malformed.status, 503);
  assert.equal((await malformed.json()).error, "state_store_response_invalid");
});

test("task inspection uses a fixed route and strips payload and lease secrets", async () => {
  const { env, calls } = bridgeEnv({
    responseBody: { ok: true, task: {
      taskId: "task-123", type: "seo.audit", state: "queued",
      createdAt: 100, updatedAt: 101, attemptCount: 1, maxAttempts: 3,
      nextAttemptAt: null, lastErrorCode: null,
      payload: { private: "do-not-return" }, leaseOwner: "private-lease-owner",
    } },
  });
  const incoming = new Request("https://agent-runtime-preview.example.workers.dev/internal/task?id=task-123", {
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN },
  });
  const response = await worker.fetch(incoming, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "https://state-store.internal/task?id=task-123");
  assert.equal(body.task.taskId, "task-123");
  assert.equal("payload" in body.task, false);
  assert.equal("leaseOwner" in body.task, false);
});

test("bridge rejects unknown query parameters and never exposes internal routes without auth", async () => {
  const { env, calls } = bridgeEnv();
  const bad = new Request("https://agent-runtime-preview.example.workers.dev/internal/task?id=task-123&path=/reserve", {
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN },
  });
  const response = await worker.fetch(bad, env);
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
  const duplicateId = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/task?id=task-123&id=task-456", {
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN },
  }), env);
  assert.equal(duplicateId.status, 400);
  assert.equal(calls.length, 0);
  const noAuth = await worker.fetch(request("/internal/usage"), env);
  assert.equal(noAuth.status, 401);
  assert.equal(calls.length, 0);
});

test("control status bridge requires operator bearer and strips query parameters", async () => {
  const { env, calls } = bridgeEnv({ responseBody: { ok: true, control: { paused: true, changedAt: 123, version: 4 } } });
  const unauthorized = await worker.fetch(request("/internal/control"), env);
  assert.equal(unauthorized.status, 401);
  assert.equal(calls.length, 0);
  const authorized = new Request("https://agent-runtime-preview.example.workers.dev/internal/control", {
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN },
  });
  const response = await worker.fetch(authorized, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.control.paused, true);
  assert.equal(calls[0].url, "https://state-store.internal/control");
  assert.equal(calls[0].method, "GET");
  const query = await worker.fetch(new Request(authorized.url + "?extra=1", {
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN },
  }), env);
  assert.equal(query.status, 400);
});

test("control mutation bridge uses configured actor and dedicated internal credential", async () => {
  const { env, calls } = bridgeEnv({ responseBody: { ok: true, changed: true, control: { paused: true, changedAt: 456, version: 5 } } });
  const incoming = new Request("https://agent-runtime-preview.example.workers.dev/internal/control/pause", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPERATOR_TOKEN,
      Cookie: "session=must-not-forward",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason: "planned maintenance" }),
  });
  const response = await worker.fetch(incoming, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.changed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://state-store.internal/control/pause");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.get("authorization"), "Bearer " + STATE_TOKEN);
  assert.equal(calls[0].headers.get("cookie"), null);
  const forwarded = await calls[0].json();
  assert.equal(forwarded.actor, "project-operator-01");
  assert.match(forwarded.requestId, /^[a-z0-9-]{16,64}$/i);
  assert.equal(forwarded.reason, "planned maintenance");
  assert.equal(JSON.stringify(forwarded).includes(OPERATOR_TOKEN), false);
  assert.equal(JSON.stringify(forwarded).includes(STATE_TOKEN), false);
});

test("control mutation bridge rejects missing operator identity and caller-supplied actor", async () => {
  const { env, calls } = bridgeEnv();
  delete env.AGENT_OPERATOR_ID;
  const missingIdentity = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/control/pause", {
    method: "POST", headers: { Authorization: "Bearer " + OPERATOR_TOKEN, "Content-Type": "application/json" }, body: "{}",
  }), env);
  assert.equal(missingIdentity.status, 503);
  env.AGENT_OPERATOR_ID = "project-operator-01";
  const spoofed = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/control/resume", {
    method: "POST", headers: { Authorization: "Bearer " + OPERATOR_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "attacker", reason: "spoof" }),
  }), env);
  assert.equal(spoofed.status, 400);
  assert.equal(calls.length, 0);
});

test("operator recovery bridge authenticates, uses a fixed internal route, and returns a sanitized task", async () => {
  const { env, calls } = bridgeEnv({ responseBody: { ok: true, outcome: "requeued", task: {
    taskId: "task-123", state: "queued", attemptCount: 2, maxAttempts: 3,
    nextAttemptAt: 1799999999000, lastErrorCode: "provider_timeout",
    payload: { private: "must-not-return" }, leaseOwner: "private-lease",
  } } });
  const incoming = new Request("https://agent-runtime-preview.example.workers.dev/internal/task/recover", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPERATOR_TOKEN,
      "Content-Type": "application/json",
      Cookie: "session=must-not-forward",
      "X-Arbitrary": "must-not-forward",
    },
    body: JSON.stringify({ taskId: "task-123" }),
  });
  const response = await worker.fetch(incoming, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.outcome, "requeued");
  assert.equal(body.task.taskId, "task-123");
  assert.equal("payload" in body.task, false);
  assert.equal("leaseOwner" in body.task, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://state-store.internal/recover");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.get("authorization"), "Bearer " + STATE_TOKEN);
  assert.equal(calls[0].headers.get("cookie"), null);
  assert.equal(calls[0].headers.get("x-arbitrary"), null);
  const forwarded = await calls[0].json();
  assert.equal(forwarded.taskId, "task-123");
  assert.equal(forwarded.actor, "project-operator-01");
  assert.match(forwarded.requestId, /^[a-z0-9-]{16,64}$/i);
  assert.equal(JSON.stringify(forwarded).includes(OPERATOR_TOKEN), false);
  assert.equal(JSON.stringify(forwarded).includes(STATE_TOKEN), false);
});

test("operator recovery rejects disabled state, missing identity, spoofing, query parameters and malformed bodies", async () => {
  const { env, calls } = bridgeEnv();
  const url = "https://agent-runtime-preview.example.workers.dev/internal/task/recover";
  const authorized = { Authorization: "Bearer " + OPERATOR_TOKEN, "Content-Type": "application/json" };

  const unauthorized = await worker.fetch(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"taskId":"task-123"}' }), env);
  assert.equal(unauthorized.status, 401);
  assert.equal(calls.length, 0);

  const disabled = await worker.fetch(new Request(url, { method: "POST", headers: authorized, body: '{"taskId":"task-123"}' }), {
    ...env, AGENT_ENABLED: "false", AGENT_PAUSED: "true",
  });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).error, "agent_disabled_or_paused");
  assert.equal(calls.length, 0);

  const unsetPaused = await worker.fetch(new Request(url, { method: "POST", headers: authorized, body: '{"taskId":"task-123"}' }), {
    ...env, AGENT_ENABLED: "true", AGENT_PAUSED: undefined,
  });
  assert.equal(unsetPaused.status, 503);
  assert.equal((await unsetPaused.json()).error, "agent_disabled_or_paused");
  assert.equal(calls.length, 0);

  delete env.AGENT_OPERATOR_ID;
  const missingIdentity = await worker.fetch(new Request(url, { method: "POST", headers: authorized, body: '{"taskId":"task-123"}' }), env);
  assert.equal(missingIdentity.status, 503);
  env.AGENT_OPERATOR_ID = "project-operator-01";

  for (const [suffix, body] of [
    ["?unexpected=1", '{"taskId":"task-123"}'],
    ["", '{"taskId":"task-123","actor":"attacker"}'],
    ["", '{"taskId":"first","taskId":"second"}'],
    ["", "{invalid-json"],
  ]) {
    const response = await worker.fetch(new Request(url + suffix, { method: "POST", headers: authorized, body }), env);
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("operator recovery maps pause and rate-limit failures without exposing State Store details", async () => {
  const url = "https://agent-runtime-preview.example.workers.dev/internal/task/recover";
  for (const [status, code, expectedStatus, expectedCode] of [
    [503, "agent_disabled_or_paused", 503, "agent_disabled_or_paused"],
    [429, "runtime_control_rate_limited", 429, "rate_limited"],
    [409, "lease_not_expired", 409, "recovery_conflict"],
    [404, "task_not_found", 404, "task_not_found"],
  ]) {
    const { env } = bridgeEnv();
    env.AGENT_STATE_STORE.get = () => ({ fetch: async () => Response.json({ ok: false, error: code }, { status }) });
    const response = await worker.fetch(new Request(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + OPERATOR_TOKEN, "Content-Type": "application/json" },
      body: '{"taskId":"task-123"}',
    }), env);
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).error, expectedCode);
  }
});

test("bridge fails closed when the internal token is missing", async () => {
  const { env, calls } = bridgeEnv();
  delete env.AGENT_STATE_STORE_TOKEN;
  const incoming = new Request("https://agent-runtime-preview.example.workers.dev/internal/usage", {
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN },
  });
  const response = await worker.fetch(incoming, env);
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});


test("bridge maps malformed and oversized State Store responses to generic unavailable errors", async () => {
  const token = OPERATOR_TOKEN;
  const incoming = new Request("https://agent-runtime-preview.example.workers.dev/internal/usage", {
    headers: { Authorization: "Bearer " + token },
  });
  for (const response of [
    new Response("not-json", { status: 200 }),
    new Response("x".repeat(16 * 1024 + 1), { status: 200 }),
    new Response(JSON.stringify({ ok: false, error: "database_sql_detail" }), { status: 500 }),
  ]) {
    const env = {
      AGENT_OPERATOR_TOKEN: token,
      AGENT_STATE_STORE_TOKEN: STATE_TOKEN,
      AGENT_STATE_STORE: {
        idFromName: () => "fixed-object-id",
        get: () => ({ fetch: async () => response }),
      },
    };
    const result = await worker.fetch(incoming, env);
    assert.equal(result.status, 503);
    const body = await result.json();
    assert.equal(body.error, "state_store_unavailable");
    assert.equal(JSON.stringify(body).includes("database_sql_detail"), false);
  }
});


test("control mutation rejects oversized declared and chunked request bodies before State Store access", async () => {
  const { env, calls } = bridgeEnv();
  const url = "https://agent-runtime-preview.example.workers.dev/internal/control/pause";
  const headers = { Authorization: "Bearer " + OPERATOR_TOKEN, "Content-Type": "application/json" };

  const declaredTooLarge = await worker.fetch(new Request(url, {
    method: "POST", headers: { ...headers, "Content-Length": "1025" }, body: "{}",
  }), env);
  assert.equal(declaredTooLarge.status, 413);
  assert.equal((await declaredTooLarge.json()).error, "request_body_too_large");

  const chunkedTooLarge = await worker.fetch(new Request(url, {
    method: "POST", headers,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1025));
        controller.close();
      },
    }),
    duplex: "half",
  }), env);
  assert.equal(chunkedTooLarge.status, 413);
  assert.equal((await chunkedTooLarge.json()).error, "request_body_too_large");

  const malformed = await worker.fetch(new Request(url, {
    method: "POST", headers, body: "{invalid-json",
  }), env);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "request_invalid");

  const duplicateField = await worker.fetch(new Request(url, {
    method: "POST", headers, body: '{"reason":"first","reason":"second"}',
  }), env);
  assert.equal(duplicateField.status, 400);
  assert.equal((await duplicateField.json()).error, "request_invalid");
  assert.equal(calls.length, 0);
});
