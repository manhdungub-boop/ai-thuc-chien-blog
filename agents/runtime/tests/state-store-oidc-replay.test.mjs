import test from "node:test";
import assert from "node:assert/strict";
import { callStateStore } from "../src/state-store-client.mjs";

const TOKEN = "internal-client-test-token-0123456789abcdef";
const JTI = "github-actions-jti-1234567890";
const EXPIRES_AT = "1800000300";

function mockNamespace(response = new Response(JSON.stringify({
  ok: true,
  consumed: true,
}), {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
})) {
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
            body: await request.text(),
          });
          return response;
        },
      };
    },
  };
  return { namespace, calls };
}

test("State Store client calls only the fixed atomic OIDC replay-consume operation", async () => {
  const { namespace, calls } = mockNamespace();
  const response = await callStateStore({
    AGENT_STATE_STORE: namespace,
    AGENT_STATE_STORE_TOKEN: TOKEN,
  }, "oidcReplayConsume", { jti: JTI, expiresAt: EXPIRES_AT });

  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { identity: "agent-runtime-global" });
  assert.deepEqual(calls[1], { id: { id: "fixed:agent-runtime-global" } });
  assert.equal(calls[2].url, "https://agent-state-store.internal/oidc/replay/consume");
  assert.equal(calls[2].method, "POST");
  assert.deepEqual(calls[2].headers.sort(), [
    ["authorization", "Bearer " + TOKEN],
    ["content-type", "application/json"],
  ]);
  assert.deepEqual(JSON.parse(calls[2].body), { jti: JTI, expiresAt: EXPIRES_AT });
});

test("State Store client rejects malformed or caller-extended OIDC replay requests", async () => {
  const { namespace, calls } = mockNamespace();
  const env = { AGENT_STATE_STORE: namespace, AGENT_STATE_STORE_TOKEN: TOKEN };

  await assert.rejects(
    () => callStateStore(env, "oidcReplayConsume", { jti: "short", expiresAt: EXPIRES_AT }),
    /state_store_oidc_replay_request_invalid/,
  );
  await assert.rejects(
    () => callStateStore(env, "oidcReplayConsume", { jti: JTI, expiresAt: "01800000300" }),
    /state_store_oidc_replay_request_invalid/,
  );
  await assert.rejects(
    () => callStateStore(env, "oidcReplayConsume", { jti: JTI, expiresAt: 1800000300 }),
    /state_store_oidc_replay_request_invalid/,
  );
  await assert.rejects(
    () => callStateStore(env, "oidcReplayConsume", {
      jti: JTI,
      expiresAt: EXPIRES_AT,
      path: "/admin",
    }),
    /state_store_oidc_replay_request_invalid/,
  );
  assert.equal(calls.length, 0);
});
