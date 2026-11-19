import test from "node:test";
import assert from "node:assert/strict";
import { hasValidOperatorBearer } from "../src/operator-auth.mjs";

const secret = "preview-only-test-secret-0123456789abcdef";
const request = (authorization) => new Request("https://agent-runtime-preview.example.workers.dev/run", {
  method: "POST",
  headers: authorization ? { Authorization: authorization } : {},
});

test("accepts an exact configured bearer token", async () => {
  assert.equal(await hasValidOperatorBearer(request("Bearer " + secret), {
    AGENT_OPERATOR_TOKEN: secret,
  }), true);
});

test("rejects missing, incorrect, malformed, and query-only credentials", async () => {
  const env = { AGENT_OPERATOR_TOKEN: secret };
  assert.equal(await hasValidOperatorBearer(request(), env), false);
  assert.equal(await hasValidOperatorBearer(request("Bearer " + secret + "x"), env), false);
  assert.equal(await hasValidOperatorBearer(request("Basic " + secret), env), false);
  assert.equal(await hasValidOperatorBearer(request(), { ...env, token: secret }), false);
});

test("fails closed for absent or weak configured secrets", async () => {
  assert.equal(await hasValidOperatorBearer(request("Bearer " + secret), {}), false);
  assert.equal(await hasValidOperatorBearer(request("Bearer short"), {
    AGENT_OPERATOR_TOKEN: "short",
  }), false);
});

test("rejects oversized and syntactically invalid bearer values", async () => {
  assert.equal(await hasValidOperatorBearer(request("Bearer " + "a".repeat(513)), {
    AGENT_OPERATOR_TOKEN: secret,
  }), false);
  assert.equal(await hasValidOperatorBearer(request("Bearer contains spaces"), {
    AGENT_OPERATOR_TOKEN: secret,
  }), false);
});
