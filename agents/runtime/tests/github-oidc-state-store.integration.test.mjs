import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { authorizeGitHubActionsOperator } from "../src/github-oidc-authorize.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "state-store-test-worker.mjs");
const STATE_STORE_TOKEN = "oidc-e2e-state-store-token-034252848589abcdef";
const ISSUER = "https://token.actions.githubusercontent.com";
const DISCOVERY_URL = ISSUER + "/.well-known/openid-configuration";
const JWKS_URL = ISSUER + "/.well-known/jwks";
const EXPECTED = Object.freeze({
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

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodeJson(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}
function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function makeGitHubFetch(jwks) {
  return async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    if (url === DISCOVERY_URL) {
      return jsonResponse({ issuer: ISSUER, jwks_uri: JWKS_URL });
    }
    if (url === JWKS_URL) return jsonResponse(jwks);
    throw new Error("unexpected_oidc_url");
  };
}
async function makeSignedFixture(jti) {
  const now = Math.floor(Date.now() / 1000);
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const jwks = {
    keys: [{
      ...publicJwk,
      kid: "oidc-e2e-test-key",
      use: "sig",
      alg: "RS256",
    }],
  };
  const header = encodeJson({
    alg: "RS256",
    typ: "JWT",
    kid: "oidc-e2e-test-key",
  });
  const claims = {
    iss: ISSUER,
    aud: EXPECTED.audience,
    sub: "repo:manhdungub-boop@342528485/ai-thuc-chien-blog@1423636651:ref:refs/heads/main",
    repository: EXPECTED.repository,
    repository_owner: EXPECTED.repositoryOwner,
    repository_owner_id: EXPECTED.repositoryOwnerId,
    repository_id: EXPECTED.repositoryId,
    ref: EXPECTED.ref,
    workflow_ref: EXPECTED.workflowRef,
    event_name: EXPECTED.eventName,
    actor_id: EXPECTED.actorId,
    jti,
    run_id: "987654321",
    run_attempt: "1",
    iat: now - 5,
    nbf: now - 5,
    exp: now + 300,
  };
  const payload = encodeJson(claims);
  const signingInput = header + "." + payload;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return {
    token: signingInput + "." + encodeBase64Url(new Uint8Array(signature)),
    now,
    jwks,
  };
}
async function withStateStore(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "ai-thuc-chien-oidc-e2e-"));
  const mf = new Miniflare({
    modules: true,
    scriptPath: workerPath,
    compatibilityDate: "2026-07-08",
    durableObjects: {
      AGENT_STATE_STORE: {
        className: "TestAgentStateStore",
        useSQLite: true,
      },
    },
    durableObjectsPersist: directory,
    bindings: {
      AGENT_STATE_STORE_TOKEN: STATE_STORE_TOKEN,
    },
  });
  try {
    const namespace = await mf.getDurableObjectNamespace("AGENT_STATE_STORE");
    const env = {
      AGENT_STATE_STORE: namespace,
      AGENT_STATE_STORE_TOKEN: STATE_STORE_TOKEN,
    };
    return await callback({ env });
  } finally {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
function callRealStateStore(env, operation, input, diagnostics) {
  assert.equal(operation, "oidcReplayConsume");
  const namespace = env.AGENT_STATE_STORE;
  const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
  return stub.fetch("http://do.local/oidc/replay/consume", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.AGENT_STATE_STORE_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  }).then(async (response) => {
    diagnostics.push({
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.clone().text(),
    });
    return response;
  }).catch((error) => {
    diagnostics.push({ thrown: String(error?.message || error) });
    throw error;
  });
}
function authorize(token, fixture, env, diagnostics) {
  return authorizeGitHubActionsOperator(token, {
    env,
    expected: EXPECTED,
    nowSeconds: fixture.now,
    fetchImpl: makeGitHubFetch(fixture.jwks),
    callStateStoreImpl: (e, op, input) => callRealStateStore(e, op, input, diagnostics),
  });
}

test("verified GitHub OIDC token is consumed by the real SQLite State Store and cannot be replayed", async () => {
  await withStateStore(async ({ env }) => {
    const fixture = await makeSignedFixture("github-actions-oidc-e2e-jti-0001");
    const diagnostics = [];
    const first = await authorize(fixture.token, fixture, env, diagnostics);
    assert.equal(first.ok, true, "first authorization failed: " + JSON.stringify(first) + "; State Store: " + JSON.stringify(diagnostics));
    assert.equal(first.replayConsumed, true);
    assert.equal(first.identity.jti, "github-actions-oidc-e2e-jti-0001");

    const replay = await authorize(fixture.token, fixture, env, diagnostics);
    assert.deepEqual(replay, { ok: false, error: "oidc_token_replayed" });
  });
});

test("concurrent authorization attempts for one signed jti yield exactly one winner", async () => {
  await withStateStore(async ({ env }) => {
    const fixture = await makeSignedFixture("github-actions-oidc-e2e-race-0001");
    const diagnostics = [];
    const results = await Promise.all([
      authorize(fixture.token, fixture, env, diagnostics),
      authorize(fixture.token, fixture, env, diagnostics),
    ]);
    assert.deepEqual(
      results.map((result) => result.ok ? "ok" : result.error).sort(),
      ["oidc_token_replayed", "ok"],
      "unexpected concurrent authorization results: " + JSON.stringify(results) + "; State Store: " + JSON.stringify(diagnostics),
    );
  });
});
