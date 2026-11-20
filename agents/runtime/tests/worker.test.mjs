import test from "node:test";
import assert from "node:assert/strict";
import worker, { runWithLeaseHeartbeat } from "../src/worker.mjs";

const request = (path, method = "GET") =>
  new Request("https://agent-runtime-preview.example.workers.dev" + path, { method });

test("lease heartbeat keeps a long bounded review alive and stops when it completes", async () => {
  let heartbeats = 0;
  const result = await runWithLeaseHeartbeat(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 24));
      return "review-complete";
    },
    async () => { heartbeats += 1; },
    5,
  );
  assert.equal(result, "review-complete");
  assert.ok(heartbeats >= 2, "a review longer than the heartbeat interval must renew its lease");
});

test("lease heartbeat does not add a write for a fast review", async () => {
  let heartbeats = 0;
  const result = await runWithLeaseHeartbeat(
    async () => "fast-review",
    async () => { heartbeats += 1; },
    20,
  );
  assert.equal(result, "fast-review");
  assert.equal(heartbeats, 0);
});

test("lease heartbeat fails closed when renewal fails", async () => {
  await assert.rejects(
    runWithLeaseHeartbeat(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 12));
        return "review-complete";
      },
      async () => { throw new Error("internal token must not escape"); },
      2,
    ),
    (error) => error.message === "task_lease_heartbeat_unavailable",
  );
});

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
  assert.equal(body.execution, "operator_triggered_read_only_analysis");
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

test("run fails closed when the pause flag is missing or malformed", async () => {
  const token = "preview-only-test-secret-034252848589abcdef";
  for (const paused of [undefined, "true", "1", "yes"]) {
    const env = { AGENT_ENABLED: "true", AGENT_OPERATOR_TOKEN: token };
    if (paused !== undefined) env.AGENT_PAUSED = paused;
    const response = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/run", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    }), env);
    assert.equal(response.status, 503, "AGENT_PAUSED=" + String(paused));
    assert.equal((await response.json()).error, "agent_disabled_or_paused");
  }
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




const OPERATOR_TOKEN = "worker-bridge-operator-token-034252848589abcdef";
const STATE_TOKEN = "worker-bridge-state-store-token-034252848589abcdef";
function bridgeEnv({ responseBody = { ok: true, dayUtc: "2026-11-19", acceptedToday: 2, inFlight: 1 }, responseStatus = 200 } = {}) {
  const calls = [];
  const stub = {
    async fetch(internalRequest) {
      calls.push(internalRequest);
      return Response.json(responseBody, { status: responseStatus });
    },
  };
  const env = {
    AGENT_OPERATOR_TOKEN: OPERATOR_TOKEN,
    AGENT_OPERATOR_ID: "project-operator-01",
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

test("task inspection uses a fixed route and strips payload and lease secrets", async () => {
  const { env, calls } = bridgeEnv({
    responseBody: { ok: true, task: {
      taskId: "task-123", type: "seo.audit", state: "queued",
      createdAt: 100, updatedAt: 101, attemptCount: 1, maxAttempts: 3,
      nextAttemptAt: null, lastErrorCode: null,
      result: { taskType: "seo.audit", status: "attention", findingCount: 0, findings: [] },
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
  assert.deepEqual(body.task.result, { taskType: "seo.audit", status: "attention", findingCount: 0, findings: [] });
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

test("operator recovery bridge requires auth, explicit runtime gates, and strict input", async () => {
  const { env, calls } = bridgeEnv({ responseBody: { ok: true, outcome: "requeued", task: {
    taskId: "task-recover-01", type: "seo.audit", state: "queued",
    attemptCount: 1, maxAttempts: 3, nextAttemptAt: 200, lastErrorCode: "lease_expired",
  } } });
  env.AGENT_ENABLED = "true";
  env.AGENT_PAUSED = "false";
  const url = "https://agent-runtime-preview.example.workers.dev/internal/recover";
  assert.equal((await worker.fetch(new Request(url, { method: "POST" }), env)).status, 401);
  const authHeaders = { Authorization: "Bearer " + OPERATOR_TOKEN, "Content-Type": "application/json" };
  assert.equal((await worker.fetch(new Request(url, { method: "GET", headers: authHeaders }), env)).status, 405);
  assert.equal((await worker.fetch(new Request(url + "?extra=1", { method: "POST", headers: authHeaders, body: '{"taskId":"task-recover-01"}' }), env)).status, 400);
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers: authHeaders, body: '{"taskId":"task-recover-01","actor":"spoof"}' }), env)).status, 400);
  assert.equal(calls.length, 0);

  env.AGENT_ENABLED = "false";
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers: authHeaders, body: '{"taskId":"task-recover-01"}' }), env)).status, 503);
  env.AGENT_ENABLED = "true";
  env.AGENT_PAUSED = "true";
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers: authHeaders, body: '{"taskId":"task-recover-01"}' }), env)).status, 503);
  assert.equal(calls.length, 0);
});

test("operator recovery bridge uses fixed State Store identity and records server actor", async () => {
  const { env, calls } = bridgeEnv({ responseBody: { ok: true, outcome: "requeued", task: {
    taskId: "task-recover-01", type: "seo.audit", state: "queued",
    attemptCount: 1, maxAttempts: 3, nextAttemptAt: 200, lastErrorCode: "lease_expired",
  } } });
  env.AGENT_ENABLED = "true";
  env.AGENT_PAUSED = "false";
  const incoming = new Request("https://agent-runtime-preview.example.workers.dev/internal/recover", {
    method: "POST",
    headers: { Authorization: "Bearer " + OPERATOR_TOKEN, Cookie: "session=must-not-forward", "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: "task-recover-01" }),
  });
  const response = await worker.fetch(incoming, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.outcome, "requeued");
  assert.equal(body.task.taskId, "task-recover-01");
  assert.equal("payload" in body.task, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://state-store.internal/recover");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.get("authorization"), "Bearer " + STATE_TOKEN);
  assert.equal(calls[0].headers.get("cookie"), null);
  const forwarded = await calls[0].json();
  assert.deepEqual(Object.keys(forwarded).sort(), ["actor", "requestId", "taskId"]);
  assert.equal(forwarded.actor, "project-operator-01");
  assert.equal(forwarded.taskId, "task-recover-01");
  assert.match(forwarded.requestId, /^[a-z0-9-]{16,64}$/i);
  assert.equal(JSON.stringify(forwarded).includes(OPERATOR_TOKEN), false);
  assert.equal(JSON.stringify(forwarded).includes(STATE_TOKEN), false);
});

test("operator recovery bridge maps State Store errors to safe public responses", async () => {
  const url = "https://agent-runtime-preview.example.workers.dev/internal/recover";
  const headers = { Authorization: "Bearer " + OPERATOR_TOKEN, "Content-Type": "application/json" };
  for (const [responseStatus, expectedStatus, expectedError] of [
    [404, 404, "task_not_found"],
    [409, 409, "task_recovery_conflict"],
    [429, 429, "rate_limited"],
    [500, 503, "state_store_unavailable"],
  ]) {
    const { env, calls } = bridgeEnv({
      responseBody: { ok: false, error: "sensitive_internal_detail", token: STATE_TOKEN },
      responseStatus,
    });
    env.AGENT_ENABLED = "true";
    env.AGENT_PAUSED = "false";
    const response = await worker.fetch(new Request(url, {
      method: "POST", headers, body: JSON.stringify({ taskId: "task-recover-01" }),
    }), env);
    const body = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.equal(body.error, expectedError);
    assert.equal(JSON.stringify(body).includes("sensitive_internal_detail"), false);
    assert.equal(JSON.stringify(body).includes(STATE_TOKEN), false);
    assert.equal(calls.length, 1);
  }
});

test("operator recovery bridge rejects malformed, oversized, and missing-identity requests", async () => {
  const { env, calls } = bridgeEnv();
  env.AGENT_ENABLED = "true";
  env.AGENT_PAUSED = "false";
  const url = "https://agent-runtime-preview.example.workers.dev/internal/recover";
  const headers = { Authorization: "Bearer " + OPERATOR_TOKEN, "Content-Type": "application/json" };
  const oversized = await worker.fetch(new Request(url, {
    method: "POST", headers: { ...headers, "Content-Length": "1025" }, body: "{}",
  }), env);
  assert.equal(oversized.status, 413);
  const malformed = await worker.fetch(new Request(url, { method: "POST", headers, body: "{bad" }), env);
  assert.equal(malformed.status, 400);
  delete env.AGENT_OPERATOR_ID;
  const missingActor = await worker.fetch(new Request(url, { method: "POST", headers, body: '{"taskId":"task-recover-01"}' }), env);
  assert.equal(missingActor.status, 503);
  assert.equal(calls.length, 0);
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


test("OIDC pause endpoint remains disabled by default and does not contact State Store", async () => {
  let called = false;
  const response = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/oidc/pause", {
    method: "POST",
    headers: { Authorization: "Bearer not-a-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "test" }),
  }), {
    AGENT_OIDC_ENABLED: "false",
    AGENT_STATE_STORE: { idFromName: () => "unused", get: () => ({ fetch: async () => { called = true; } }) },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "oidc_operator_disabled");
  assert.equal(called, false);
});

test("OIDC pause endpoint fails closed when the exact actor trust policy is incomplete", async () => {
  let called = false;
  const response = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/oidc/pause", {
    method: "POST",
    headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "test" }),
  }), {
    AGENT_OIDC_ENABLED: "true",
    AGENT_OIDC_AUDIENCE: "ai-thuc-chien-agent-runtime-preview",
    AGENT_OIDC_REPOSITORY: "manhdungub-boop/ai-thuc-chien-blog",
    AGENT_OIDC_REPOSITORY_OWNER: "manhdungub-boop",
    AGENT_OIDC_REPOSITORY_ID: "1423636651",
    AGENT_OIDC_REPOSITORY_OWNER_ID: "342528485",
    AGENT_OIDC_REF: "refs/heads/main",
    AGENT_OIDC_WORKFLOW_REF: "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/agent-runtime-operator.yml@refs/heads/main",
    AGENT_OIDC_ACTOR_ID: "",
    AGENT_STATE_STORE: { idFromName: () => "unused", get: () => ({ fetch: async () => { called = true; } }) },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "github_oidc_policy_unconfigured");
  assert.equal(called, false);
});

test("OIDC pause endpoint rejects shared bearer credentials as malformed JWT input", async () => {
  const shared = "preview-only-test-secret-034252848589abcdef";
  const response = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/oidc/pause", {
    method: "POST",
    headers: { Authorization: "Bearer " + shared, "Content-Type": "application/json" },
    body: "{}",
  }), {
    AGENT_OIDC_ENABLED: "true",
    AGENT_OIDC_AUDIENCE: "ai-thuc-chien-agent-runtime-preview",
    AGENT_OIDC_REPOSITORY: "manhdungub-boop/ai-thuc-chien-blog",
    AGENT_OIDC_REPOSITORY_OWNER: "manhdungub-boop",
    AGENT_OIDC_REPOSITORY_ID: "1423636651",
    AGENT_OIDC_REPOSITORY_OWNER_ID: "342528485",
    AGENT_OIDC_REF: "refs/heads/main",
    AGENT_OIDC_WORKFLOW_REF: "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/agent-runtime-operator.yml@refs/heads/main",
    AGENT_OIDC_ACTOR_ID: "342528485",
    AGENT_STATE_STORE: { idFromName: () => "unused", get: () => ({ fetch: async () => { throw new Error("must_not_reach_state_store"); } }) },
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "github_oidc_token_required");
});

const RUN_TOKEN = "preview-read-only-run-token-034252848589abcdef";
const RUN_STATE_TOKEN = "preview-read-only-state-token-034252848589abcdef";
const RUN_URL = "https://agent-runtime-preview.example.workers.dev/run";

function durableRunEnv() {
  const records = new Map();
  const idempotency = new Map();
  const calls = [];
  let sequence = 0;
  const stub = {
    async fetch(internalRequest) {
      calls.push(internalRequest);
      const url = new URL(internalRequest.url);
      const body = internalRequest.method === "POST" ? await internalRequest.json() : null;
      if (url.pathname === "/reserve") {
        const existingId = idempotency.get(body.task.idempotencyKey);
        if (existingId) return Response.json({ ok: true, duplicate: true, task: records.get(existingId) });
        const task = {
          taskId: "task-" + (++sequence),
          type: body.task.type,
          payload: body.task.payload,
          idempotencyKey: body.task.idempotencyKey,
          state: "queued",
        };
        records.set(task.taskId, task);
        idempotency.set(task.idempotencyKey, task.taskId);
        return Response.json({ ok: true, duplicate: false, task }, { status: 201 });
      }
      if (url.pathname === "/claim-next") {
        const task = [...records.values()].find((item) => item.state === "queued");
        if (!task) return Response.json({ ok: true, task: null, lease: null });
        task.state = "running";
        task.lease = { owner: "lease-owner-" + task.taskId, generation: 1 };
        return Response.json({ ok: true, task, lease: task.lease });
      }
      if (url.pathname === "/claim") {
        const task = records.get(body.taskId);
        if (!task || task.state !== "queued") return Response.json({ ok: false, error: "task_not_claimable" }, { status: 409 });
        task.state = "running";
        task.lease = { owner: "lease-owner-" + task.taskId, generation: 1 };
        return Response.json({ ok: true, task, lease: task.lease });
      }
      if (url.pathname === "/complete") {
        const task = records.get(body.taskId);
        if (!task || task.state !== "running" || task.lease.owner !== body.leaseOwner ||
            task.lease.generation !== body.leaseGeneration) {
          return Response.json({ ok: false, error: "lease_fencing_conflict" }, { status: 409 });
        }
        task.state = body.status;
        delete task.lease;
        return Response.json({ ok: true, task });
      }
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  };
  const env = {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: RUN_TOKEN,
    AGENT_STATE_STORE_TOKEN: RUN_STATE_TOKEN,
    AGENT_STATE_STORE: {
      idFromName(name) { assert.equal(name, "agent-runtime-global"); return "fixed-object-id"; },
      get(id) { assert.equal(id, "fixed-object-id"); return stub; },
    },
  };
  return { env, records, calls };
}

test("run reserves, claims, reviews, and completes durable read-only tasks", async () => {
  const originalFetch = globalThis.fetch;
  const articleHtml = `<!doctype html><html><head>
    <title>Demo article</title>
    <meta name="description" content="This is a sufficiently detailed description for a content quality review.">
    <meta name="author" content="DUNG - AI">
    <link rel="canonical" href="https://ai-thuc-chien-blog.manhdungub.workers.dev/articles/demo-article">
    <script type="application/ld+json">{"@type":"BlogPosting"}</script>
    </head><body><section class="article-author-note">Bài viết gốc DUNG - AI; vui lòng ghi công và dẫn liên kết về bài viết.</section>
    <a href="/thu-vien.html">Library</a><main>${"useful content ".repeat(270)}</main></body></html>`;
  const catalog = {
    tools: [{
      id: "chatgpt", name: "ChatGPT", vendor: "OpenAI",
      website: "https://chatgpt.com/",
      official_sources: ["https://chatgpt.com/pricing/"],
      pricing_model: "freemium", pricing_status: "verified_free_tier",
      last_verified: "2026-11-15", verification_status: "verified",
    }],
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/articles/demo-article.html")) return new Response(articleHtml, { status: 200 });
    if (url.endsWith("/data/ai-tools.json")) return new Response(JSON.stringify(catalog), { status: 200 });
    throw new Error("unexpected_source_url");
  };
  const { env, records, calls } = durableRunEnv();
  const taskBatch = [
    { type: "content.review", idempotencyKey: "content-review-demo-0001", payload: { articlePath: "articles/demo-article.html" } },
    { type: "ai_bank.candidate_review", idempotencyKey: "ai-bank-review-demo-0001", payload: { candidateId: "chatgpt" } },
  ];
  try {
    const response = await worker.fetch(new Request(RUN_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: taskBatch }),
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.execution, "synchronous_leased_read_only_review");
    assert.equal(body.items.length, 2);
    assert.equal(body.items[0].result.status, "pass");
    assert.equal(body.items[1].result.status, "pass");
    assert.equal(body.summary.succeeded, 2);
    assert.equal(records.size, 2);
    assert.deepEqual([...records.values()].map((task) => task.state), ["succeeded", "succeeded"]);
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname),
      ["/reserve", "/claim", "/complete", "/reserve", "/claim", "/complete"]);
    assert.equal(calls.every((call) => call.headers.get("authorization") === "Bearer " + RUN_STATE_TOKEN), true);
    assert.equal(JSON.stringify(body).includes(RUN_STATE_TOKEN), false);
    assert.equal(body.limitations.includes("no_scheduler_or_background_execution"), true);

    const repeated = await worker.fetch(new Request(RUN_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: taskBatch }),
    }), env);
    const repeatedBody = await repeated.json();
    assert.equal(repeated.status, 200);
    assert.equal(repeatedBody.ok, true);
    assert.deepEqual(repeatedBody.items.map((item) => ({ state: item.state, duplicate: item.duplicate })), [
      { state: "succeeded", duplicate: true },
      { state: "succeeded", duplicate: true },
    ]);
    assert.equal(calls.length, 8);
    assert.deepEqual(calls.slice(6).map((call) => new URL(call.url).pathname), ["/reserve", "/reserve"],
      "completed idempotent tasks must not be claimed or executed again");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operator queue admission stores bounded idempotent tasks without executing them", async () => {
  const { env, records, calls } = durableRunEnv();
  const tasks = [
    { type: "content.review", idempotencyKey: "content-review-queued-0001", payload: { articlePath: "articles/demo-article.html" } },
    { type: "ai_bank.candidate_review", idempotencyKey: "ai-bank-review-queued-0001", payload: { candidateId: "chatgpt" } },
  ];
  const url = "https://agent-runtime-preview.example.workers.dev/internal/enqueue";
  const request = () => new Request(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ tasks }),
  });
  const first = await worker.fetch(request(), env);
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.mode, "operator_triggered_queue_admission");
  assert.equal(firstBody.execution, "not_started");
  assert.equal(firstBody.summary.newlyQueued, 2);
  assert.deepEqual([...records.values()].map((task) => task.state), ["queued", "queued"]);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/reserve", "/reserve"]);

  const repeated = await worker.fetch(request(), env);
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 200);
  assert.equal(repeatedBody.summary.duplicates, 2);
  assert.deepEqual([...records.values()].map((task) => task.state), ["queued", "queued"]);
  assert.equal(calls.some((call) => ["/claim", "/claim-next", "/complete"].includes(new URL(call.url).pathname)), false);
});

test("operator queue admission requires authentication, gates, and valid bounded tasks", async () => {
  const { env } = durableRunEnv();
  const url = "https://agent-runtime-preview.example.workers.dev/internal/enqueue";
  const unauthorized = await worker.fetch(new Request(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks: [{ type: "seo.audit", idempotencyKey: "seo-audit-queued-0001", payload: { path: "/" } }] }),
  }), env);
  assert.equal(unauthorized.status, 401);
  const paused = await worker.fetch(new Request(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ tasks: [{ type: "seo.audit", idempotencyKey: "seo-audit-queued-0001", payload: { path: "/" } }] }),
  }), { ...env, AGENT_PAUSED: "true" });
  assert.equal(paused.status, 503);
  const invalid = await worker.fetch(new Request(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ tasks: [] }),
  }), env);
  assert.equal(invalid.status, 400);
});

test("scheduled dispatcher remains inert unless its exact cron and all runtime gates are enabled", async () => {
  const { env, calls } = durableRunEnv();
  env.AGENT_SCHEDULER_ENABLED = "false";
  await worker.scheduled({ cron: "*/30 * * * *" }, env, {});
  assert.equal(calls.length, 0);
  env.AGENT_SCHEDULER_ENABLED = "true";
  env.AGENT_ENABLED = "false";
  env.AGENT_RECOVERY_ALARM_ENABLED = "true";
  await worker.scheduled({ cron: "*/30 * * * *" }, env, {});
  env.AGENT_ENABLED = "true";
  env.AGENT_PAUSED = "false";
  env.AGENT_RECOVERY_ALARM_ENABLED = "false";
  await worker.scheduled({ cron: "*/30 * * * *" }, env, {});
  env.AGENT_RECOVERY_ALARM_ENABLED = "true";
  await worker.scheduled({ cron: "*/15 * * * *" }, env, {});
  assert.equal(calls.length, 0);
});

test("scheduled dispatcher processes at most one queued read-only task per configured tick", async () => {
  const originalFetch = globalThis.fetch;
  const articleHtml = `<!doctype html><html><head>
    <title>Demo article</title>
    <meta name="description" content="This is a sufficiently detailed description for a content quality review.">
    <meta name="author" content="DUNG - AI">
    <link rel="canonical" href="https://ai-thuc-chien-blog.manhdungub.workers.dev/articles/demo-article">
    <script type="application/ld+json">{"@type":"BlogPosting"}</script>
    </head><body><section class="article-author-note">Bài viết gốc DUNG - AI; vui lòng ghi công và dẫn liên kết về bài viết.</section>
    <a href="/thu-vien.html">Library</a><main>${"useful content ".repeat(270)}</main></body></html>`;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/articles/demo-article.html")) return new Response(articleHtml, { status: 200 });
    throw new Error("unexpected_source_url");
  };
  const { env, records, calls } = durableRunEnv();
  env.AGENT_SCHEDULER_ENABLED = "true";
  env.AGENT_RECOVERY_ALARM_ENABLED = "true";
  for (const taskId of ["scheduled-1", "scheduled-2"]) {
    records.set(taskId, {
      taskId, type: "content.review",
      payload: { articlePath: "articles/demo-article.html" },
      idempotencyKey: "scheduled-content-review-" + taskId,
      state: "queued",
    });
  }
  try {
    await worker.scheduled({ cron: "*/30 * * * *" }, env, {});
    assert.equal(records.get("scheduled-1").state, "succeeded");
    assert.equal(records.get("scheduled-2").state, "queued");
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/claim-next", "/complete"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operator queue dispatcher processes only a bounded number of already-queued read-only tasks", async () => {
  const originalFetch = globalThis.fetch;
  const articleHtml = `<!doctype html><html><head>
    <title>Demo article</title>
    <meta name="description" content="This is a sufficiently detailed description for a content quality review.">
    <meta name="author" content="DUNG - AI">
    <link rel="canonical" href="https://ai-thuc-chien-blog.manhdungub.workers.dev/articles/demo-article">
    <script type="application/ld+json">{"@type":"BlogPosting"}</script>
    </head><body><section class="article-author-note">Bài viết gốc DUNG - AI; vui lòng ghi công và dẫn liên kết về bài viết.</section>
    <a href="/thu-vien.html">Library</a><main>${"useful content ".repeat(270)}</main></body></html>`;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/articles/demo-article.html")) return new Response(articleHtml, { status: 200 });
    throw new Error("unexpected_source_url");
  };
  const { env, records, calls } = durableRunEnv();
  records.set("queued-1", {
    taskId: "queued-1", type: "content.review",
    payload: { articlePath: "articles/demo-article.html" },
    idempotencyKey: "queued-content-review-0001", state: "queued",
  });
  records.set("queued-2", {
    taskId: "queued-2", type: "content.review",
    payload: { articlePath: "articles/demo-article.html" },
    idempotencyKey: "queued-content-review-0002", state: "queued",
  });
  try {
    const response = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/dispatch", {
      method: "POST",
      headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ maxTasks: 1 }),
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, "operator_triggered_bounded_queue_dispatch");
    assert.equal(body.summary.processed, 1);
    assert.equal(body.summary.succeeded, 1);
    assert.equal(records.get("queued-1").state, "succeeded");
    assert.equal(records.get("queued-2").state, "queued", "dispatcher must honor the caller's hard batch bound");
    assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/claim-next", "/complete"]);
    assert.equal(JSON.stringify(body).includes(RUN_STATE_TOKEN), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operator queue dispatcher requires authentication, explicit gates, and strict bounded input", async () => {
  const { env } = durableRunEnv();
  const url = "https://agent-runtime-preview.example.workers.dev/internal/dispatch";
  const unauthorized = await worker.fetch(new Request(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxTasks: 1 }),
  }), env);
  assert.equal(unauthorized.status, 401);
  const disabled = await worker.fetch(new Request(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ maxTasks: 1 }),
  }), { ...env, AGENT_PAUSED: "true" });
  assert.equal(disabled.status, 503);
  const invalid = await worker.fetch(new Request(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ maxTasks: 6 }),
  }), env);
  assert.equal(invalid.status, 400);
  const query = await worker.fetch(new Request(url + "?limit=5", {
    method: "POST",
    headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ maxTasks: 1 }),
  }), env);
  assert.equal(query.status, 400);
});

test("run durably marks unavailable SEO evidence as failed without inventing a pass", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("SEO source should not be fetched"); };
  const { env, records } = durableRunEnv();
  try {
    const response = await worker.fetch(new Request(RUN_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: [
        { type: "seo.audit", idempotencyKey: "seo-review-demo-0001", payload: { path: "/" } },
      ] }),
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.items[0].result.error, "read_only_source_error");
    assert.equal(body.items[0].state, "failed");
    assert.equal([...records.values()][0].state, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("run rejects missing durable State Store binding before any source read", async () => {
  const env = {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: RUN_TOKEN,
    AGENT_STATE_STORE_TOKEN: RUN_STATE_TOKEN,
  };
  const response = await worker.fetch(new Request(RUN_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ tasks: [
      { type: "content.review", idempotencyKey: "content-review-demo-0002", payload: { articlePath: "articles/demo-article.html" } },
    ] }),
  }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "durable_review_unavailable");
});

test("run rejects oversized batches, malformed JSON, and unexpected query parameters", async () => {
  const headers = { Authorization: "Bearer " + RUN_TOKEN, "Content-Type": "application/json" };
  const { env } = durableRunEnv();
  const tooMany = await worker.fetch(new Request(RUN_URL, {
    method: "POST", headers,
    body: JSON.stringify({ tasks: Array.from({ length: 6 }, (_, i) => ({
      type: "seo.audit", idempotencyKey: "seo-review-" + String(i).padStart(8, "0"),
      payload: { path: "/" },
    })) }),
  }), env);
  assert.equal(tooMany.status, 400);
  const malformed = await worker.fetch(new Request(RUN_URL, {
    method: "POST", headers, body: "{bad",
  }), env);
  assert.equal(malformed.status, 400);
  const query = await worker.fetch(new Request(RUN_URL + "?url=https://evil.example", {
    method: "POST", headers, body: JSON.stringify({ tasks: [] }),
  }), env);
  assert.equal(query.status, 400);
});
