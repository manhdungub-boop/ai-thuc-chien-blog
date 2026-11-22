import test from "node:test";
import assert from "node:assert/strict";
import { authorizeGitHubActionsOperator } from "../src/github-oidc-authorize.mjs";

const now = 1_800_000_000;
const expected = Object.freeze({
  audience: "ai-thuc-chien-agent-runtime-preview",
  repository: "manhdungub-boop/ai-thuc-chien-blog",
  repositoryOwner: "manhdungub-boop",
  repositoryId: "1423636651",
  repositoryOwnerId: "342528485",
  ref: "refs/heads/main",
  workflowRef: "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/agent-runtime-operator.yml@refs/heads/main",
  actorId: "342528485",
  eventName: "workflow_dispatch",
});
const issuer = "https://token.actions.githubusercontent.com";
const jwksUrl = issuer + "/.well-known/jwks";

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodeJson(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function fetchSequence(responses) {
  let index = 0;
  return async (url, options) => {
    if (url === jwksUrl) assert.equal(options.redirect, "manual");
    const response = responses[index++];
    if (response instanceof Error) throw response;
    if (!response) throw new Error("unexpected_fetch");
    return response;
  };
}
async function makeFixture() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jwks = { keys: [{ ...jwk, kid: "authorize-test-key", use: "sig", alg: "RS256" }] };
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid: "authorize-test-key" });
  const claims = {
    iss: issuer,
    aud: expected.audience,
    sub: "repo:manhdungub-boop@342528485/ai-thuc-chien-blog@1423636651:ref:refs/heads/main",
    repository: expected.repository,
    repository_owner: expected.repositoryOwner,
    repository_owner_id: expected.repositoryOwnerId,
    repository_id: expected.repositoryId,
    ref: expected.ref,
    workflow_ref: expected.workflowRef,
    event_name: expected.eventName,
    actor_id: expected.actorId,
    jti: "authorize-test-jti-0001",
    run_id: "987654321",
    run_attempt: "1",
    iat: now - 10,
    nbf: now - 10,
    exp: now + 300,
  };
  const payload = encodeJson(claims);
  const input = header + "." + payload;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(input));
  const token = input + "." + encodeBase64Url(new Uint8Array(signature));
  const fetchImpl = fetchSequence([
    jsonResponse({ issuer, jwks_uri: jwksUrl }),
    jsonResponse(jwks),
  ]);
  return { token, fetchImpl, claims };
}

test("authorizes only after the State Store atomically consumes the verified jti", async () => {
  const { token, fetchImpl, claims } = await makeFixture();
  const calls = [];
  const result = await authorizeGitHubActionsOperator(token, {
    expected,
    nowSeconds: now,
    fetchImpl,
    env: { marker: "preview" },
    callStateStoreImpl: async (env, operation, input) => {
      calls.push({ env, operation, input });
      return jsonResponse({ ok: true, consumed: true });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.replayConsumed, true);
  assert.equal(result.identity.jti, claims.jti);
  assert.deepEqual(calls, [{
    env: { marker: "preview" },
    operation: "oidcReplayConsume",
    input: { jti: claims.jti, expiresAt: String(claims.exp) },
  }]);
});

test("rejects a replayed token and does not return an authorized identity", async () => {
  const { token, fetchImpl } = await makeFixture();
  const result = await authorizeGitHubActionsOperator(token, {
    expected,
    nowSeconds: now,
    fetchImpl,
    callStateStoreImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: "oidc_token_replayed",
    }), { status: 409, headers: { "content-type": "application/json" } }),
  });
  assert.deepEqual(result, { ok: false, error: "oidc_token_replayed" });
});

test("fails closed when replay storage is unavailable or returns an invalid body", async () => {
  const first = await makeFixture();
  const unavailable = await authorizeGitHubActionsOperator(first.token, {
    expected,
    nowSeconds: now,
    fetchImpl: first.fetchImpl,
    callStateStoreImpl: async () => { throw new Error("offline"); },
  });
  assert.deepEqual(unavailable, { ok: false, error: "oidc_replay_store_unavailable" });

  const second = await makeFixture();
  const malformed = await authorizeGitHubActionsOperator(second.token, {
    expected,
    nowSeconds: now,
    fetchImpl: second.fetchImpl,
    callStateStoreImpl: async () => new Response("{", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.deepEqual(malformed, { ok: false, error: "oidc_replay_response_invalid" });
});

test("does not contact State Store when JWT verification fails", async () => {
  const { token, fetchImpl } = await makeFixture();
  let called = false;
  const parts = token.split(".");
  parts[2] = encodeBase64Url(new Uint8Array(256).fill(3));
  const result = await authorizeGitHubActionsOperator(parts.join("."), {
    expected,
    nowSeconds: now,
    fetchImpl,
    callStateStoreImpl: async () => { called = true; return jsonResponse({ ok: true, consumed: true }); },
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});
