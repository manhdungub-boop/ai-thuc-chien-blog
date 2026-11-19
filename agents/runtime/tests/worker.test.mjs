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
  const noAuth = await worker.fetch(request("/internal/usage"), env);
  assert.equal(noAuth.status, 401);
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
