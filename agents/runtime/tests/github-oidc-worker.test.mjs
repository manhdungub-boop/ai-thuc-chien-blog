import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "ai-thuc-chien-agent-runtime-preview";
const EXPECTED = Object.freeze({
  repository: "manhdungub-boop/ai-thuc-chien-blog",
  repositoryOwner: "manhdungub-boop",
  repositoryId: "1423636651",
  repositoryOwnerId: "342528485",
  ref: "refs/heads/main",
  workflowRef: "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/agent-runtime-operator.yml@refs/heads/main",
  actorId: "342528485",
  eventName: "workflow_dispatch",
});
const STATE_TOKEN = "oidc-worker-state-store-token-034252848589abcdef";

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodeJson(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function makeToken() {
  const now = Math.floor(Date.now() / 1000);
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jwks = { keys: [{ ...publicJwk, kid: "worker-oidc-test", use: "sig", alg: "RS256" }] };
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid: "worker-oidc-test" });
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "repo:manhdungub-boop/ai-thuc-chien-blog:ref:refs/heads/main",
    repository: EXPECTED.repository,
    repository_owner: EXPECTED.repositoryOwner,
    repository_id: EXPECTED.repositoryId,
    repository_owner_id: EXPECTED.repositoryOwnerId,
    ref: EXPECTED.ref,
    workflow_ref: EXPECTED.workflowRef,
    actor_id: EXPECTED.actorId,
    event_name: EXPECTED.eventName,
    jti: "worker-oidc-pause-jti-000001",
    run_id: "99887766",
    run_attempt: "1",
    iat: now - 5,
    nbf: now - 5,
    exp: now + 300,
  };
  const input = header + "." + encodeJson(claims);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(input));
  return { token: input + "." + encodeBase64Url(new Uint8Array(signature)), jwks, expiresAt: claims.exp };
}

test("OIDC pause verifies GitHub signature, consumes jti, and records only the verified actor", async (t) => {
  const { token, jwks, expiresAt } = await makeToken();
  const fetchCalls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url) === ISSUER + "/.well-known/openid-configuration") {
      return Response.json({ issuer: ISSUER, jwks_uri: ISSUER + "/.well-known/jwks" });
    }
    if (String(url) === ISSUER + "/.well-known/jwks") return Response.json(jwks);
    throw new Error("unexpected_external_request");
  });

  const internalCalls = [];
  const env = {
    // Emergency pause must remain reachable even when execution is disabled
    // or already paused by the fail-closed runtime defaults.
    AGENT_ENABLED: "false",
    AGENT_PAUSED: "true",
    AGENT_OIDC_ENABLED: "true",
    AGENT_OIDC_AUDIENCE: AUDIENCE,
    AGENT_OIDC_REPOSITORY: EXPECTED.repository,
    AGENT_OIDC_REPOSITORY_OWNER: EXPECTED.repositoryOwner,
    AGENT_OIDC_REPOSITORY_ID: EXPECTED.repositoryId,
    AGENT_OIDC_REPOSITORY_OWNER_ID: EXPECTED.repositoryOwnerId,
    AGENT_OIDC_REF: EXPECTED.ref,
    AGENT_OIDC_WORKFLOW_REF: EXPECTED.workflowRef,
    AGENT_OIDC_ACTOR_ID: EXPECTED.actorId,
    AGENT_STATE_STORE_TOKEN: STATE_TOKEN,
    AGENT_STATE_STORE: {
      idFromName(name) { assert.equal(name, "agent-runtime-global"); return "fixed-id"; },
      get(id) {
        assert.equal(id, "fixed-id");
        return {
          async fetch(internalRequest) {
            internalCalls.push(internalRequest);
            assert.equal(internalRequest.headers.get("authorization"), "Bearer " + STATE_TOKEN);
            assert.equal(internalRequest.headers.get("cookie"), null);
            if (new URL(internalRequest.url).pathname === "/oidc/replay/consume") {
              assert.deepEqual(await internalRequest.json(), {
                jti: "worker-oidc-pause-jti-000001",
                expiresAt: String(expiresAt),
              });
              return Response.json({ ok: true, consumed: true });
            }
            assert.equal(new URL(internalRequest.url).pathname, "/control/pause");
            const payload = await internalRequest.json();
            assert.equal(payload.actor, "github-actions:342528485");
            assert.equal(typeof payload.requestId, "string");
            assert.equal(payload.reason, "manual safety test");
            return Response.json({ ok: true, changed: true, control: { paused: true, changedAt: Date.now(), version: 1 } });
          },
        };
      },
    },
  };

  const response = await worker.fetch(new Request("https://agent-runtime-preview.example.workers.dev/internal/oidc/pause", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Cookie: "must-not-forward" },
    body: JSON.stringify({ reason: "manual safety test" }),
  }), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.control.paused, true);
  assert.equal(internalCalls.length, 2);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].options.redirect, "error");
  assert.equal(fetchCalls[1].options.redirect, "error");
  assert.equal(fetchCalls[0].options.headers.Authorization, undefined);
  assert.equal(JSON.stringify(body).includes(STATE_TOKEN), false);
});
