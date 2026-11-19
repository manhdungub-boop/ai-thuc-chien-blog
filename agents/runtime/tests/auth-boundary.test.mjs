import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

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
