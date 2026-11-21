import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import { hasValidStateStoreBearer } from "../src/internal-auth.mjs";

const OPERATOR = "operator-test-token-0123456789abcdef";
const INTERNAL = "internal-test-token-0123456789abcdef";

test("Worker ingress accepts only the external operator credential, never the internal State Store token", async () => {
  const env = {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: OPERATOR,
    AGENT_STATE_STORE_TOKEN: INTERNAL,
  };
  const internal = await worker.fetch(new Request("https://runtime.test/run", {
    method: "POST",
    headers: { Authorization: "Bearer " + INTERNAL },
  }), env);
  assert.equal(internal.status, 401);
  assert.equal((await internal.json()).error, "operator_auth_required");

  const operator = await worker.fetch(new Request("https://runtime.test/run", {
    method: "POST",
    headers: { Authorization: "Bearer " + OPERATOR },
  }), env);
  assert.equal(operator.status, 501);
  assert.equal((await operator.json()).error, "execution_not_implemented");
});

test("Worker ingress fails closed when the operator credential is absent", async () => {
  const response = await worker.fetch(new Request("https://runtime.test/run", { method: "POST" }), {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_STATE_STORE_TOKEN: INTERNAL,
  });
  assert.equal(response.status, 401);
});

test("internal State Store authentication rejects missing, weak, malformed, and wrong credentials", async () => {
  const request = (authorization) => new Request("https://store.test/usage", {
    headers: authorization === null ? {} : { Authorization: authorization },
  });
  assert.equal(await hasValidStateStoreBearer(request("Bearer " + INTERNAL), {}), false);
  assert.equal(await hasValidStateStoreBearer(request("Bearer " + INTERNAL), { AGENT_STATE_STORE_TOKEN: "short" }), false);
  assert.equal(await hasValidStateStoreBearer(request("Bearer " + INTERNAL), { AGENT_STATE_STORE_TOKEN: "x".repeat(513) }), false);
  assert.equal(await hasValidStateStoreBearer(request(null), { AGENT_STATE_STORE_TOKEN: INTERNAL }), false);
  assert.equal(await hasValidStateStoreBearer(request("Basic " + INTERNAL), { AGENT_STATE_STORE_TOKEN: INTERNAL }), false);
  assert.equal(await hasValidStateStoreBearer(request("Bearer short"), { AGENT_STATE_STORE_TOKEN: INTERNAL }), false);
  assert.equal(await hasValidStateStoreBearer(request("Bearer " + OPERATOR), { AGENT_STATE_STORE_TOKEN: INTERNAL }), false);
  assert.equal(await hasValidStateStoreBearer(request("Bearer " + INTERNAL.slice(0, -1) + "x"), { AGENT_STATE_STORE_TOKEN: INTERNAL }), false);
});

test("internal State Store credential rotation rejects the old token and accepts only the new token", async () => {
  const OLD_INTERNAL = "previous-internal-token-0123456789abcdef";
  const NEW_INTERNAL = "rotated-internal-token-0123456789abcdef";
  const bearer = (token) => new Request("https://store.test/usage", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(await hasValidStateStoreBearer(bearer(OLD_INTERNAL), { AGENT_STATE_STORE_TOKEN: NEW_INTERNAL }), false);
  assert.equal(await hasValidStateStoreBearer(bearer(NEW_INTERNAL), { AGENT_STATE_STORE_TOKEN: NEW_INTERNAL }), true);
});
