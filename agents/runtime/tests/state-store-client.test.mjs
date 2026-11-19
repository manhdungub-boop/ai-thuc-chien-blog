import test from "node:test";
import assert from "node:assert/strict";
import { callStateStore } from "../src/state-store-client.mjs";

const TOKEN = "internal-client-test-token-0123456789abcdef";

function mockNamespace(response = new Response("{}", { status: 200 })) {
  const calls = [];
  const namespace = {
    idFromName(name) {
      calls.push({ identity: name });
      return { id: "fixed:" + name };
    },
    get(id) {
      calls.push({ id });
      return {
        async fetch(request) {
          calls.push({
            url: request.url,
            method: request.method,
            headers: [...request.headers.entries()],
            body: request.method === "POST" ? await request.text() : null,
          });
          return response;
        },
      };
    },
  };
  return { namespace, calls };
}

test("State Store client uses a fixed object identity and only the dedicated internal credential", async () => {
  const { namespace, calls } = mockNamespace();
  const response = await callStateStore({
    AGENT_STATE_STORE: namespace,
    AGENT_STATE_STORE_TOKEN: TOKEN,
  }, "reserve", { task: { type: "seo.audit", idempotencyKey: "test-key-0123456789abcdef", payload: { path: "/guides" } } });

  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { identity: "agent-runtime-global" });
  assert.deepEqual(calls[1], { id: { id: "fixed:agent-runtime-global" } });
  const request = calls[2];
  assert.equal(request.url, "https://agent-state-store.internal/reserve");
  assert.equal(request.method, "POST");
  assert.deepEqual(request.headers.sort(), [
    ["authorization", "Bearer " + TOKEN],
    ["content-type", "application/json"],
  ]);
  assert.match(request.body, /"type":"seo.audit"/);
});

test("State Store client allows only fixed operations and rejects caller-controlled paths", async () => {
  const { namespace, calls } = mockNamespace();
  const env = { AGENT_STATE_STORE: namespace, AGENT_STATE_STORE_TOKEN: TOKEN };
  await assert.rejects(() => callStateStore(env, "../admin", {}), /operation_not_allowed/);
  await assert.rejects(() => callStateStore(env, "reserve", { url: "https://attacker.test" }), /state_store_request_invalid/);
  assert.equal(calls.length, 0);
});

test("State Store client fails closed without a binding or strong internal token", async () => {
  await assert.rejects(() => callStateStore({}, "usage", {}), /state_store_unavailable/);
  const { namespace, calls } = mockNamespace();
  await assert.rejects(() => callStateStore({ AGENT_STATE_STORE: namespace }, "usage", {}), /state_store_unavailable/);
  await assert.rejects(() => callStateStore({
    AGENT_STATE_STORE: namespace,
    AGENT_STATE_STORE_TOKEN: "short",
  }, "usage", {}), /state_store_unavailable/);
  assert.equal(calls.length, 0);
});

test("State Store client validates read queries and bounds POST bodies", async () => {
  const { namespace, calls } = mockNamespace();
  const env = { AGENT_STATE_STORE: namespace, AGENT_STATE_STORE_TOKEN: TOKEN };
  await assert.rejects(() => callStateStore(env, "task", { taskId: "x".repeat(65) }), /task_id_invalid/);
  await assert.rejects(() => callStateStore(env, "usage", { day: "not-a-date" }), /usage_day_invalid/);
  await assert.rejects(() => callStateStore(env, "transition", {
    taskId: "task-1",
    status: "failed",
    errorCode: "x".repeat(20_000),
  }), /request_too_large/);
  assert.equal(calls.length, 0);
});

test("State Store client builds encoded GET queries without forwarding arbitrary headers", async () => {
  const { namespace, calls } = mockNamespace();
  await callStateStore({
    AGENT_STATE_STORE: namespace,
    AGENT_STATE_STORE_TOKEN: TOKEN,
  }, "task", { taskId: "task id/with?reserved" });
  const request = calls[2];
  assert.equal(request.method, "GET");
  assert.equal(request.url, "https://agent-state-store.internal/task?id=task+id%2Fwith%3Freserved");
  assert.deepEqual(request.headers, [["authorization", "Bearer " + TOKEN]]);
});
