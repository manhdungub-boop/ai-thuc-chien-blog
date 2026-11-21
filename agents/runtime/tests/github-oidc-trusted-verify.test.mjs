import test from "node:test";
import assert from "node:assert/strict";
import { verifyGitHubActionsOidcTokenWithTrustedJwks } from "../src/github-oidc-trusted-verify.mjs";

const now = 1_800_000_000;
const expected = Object.freeze({
  audience: "ai-thuc-chien-agent-runtime-preview",
  repository: "manhdungub-boop/ai-thuc-chien-blog",
  repositoryOwner: "manhdungub-boop",
  repositoryId: "1423636651",
  repositoryOwnerId: "342528485",
  ref: "refs/heads/main",
  workflowRef: "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/agent-runtime-operator.yml@refs/heads/main",
  actorId: "1234567",
  eventName: "workflow_dispatch",
});

const issuer = "https://token.actions.githubusercontent.com";
const discoveryUrl = issuer + "/.well-known/openid-configuration";
const jwksUrl = issuer + "/.well-known/jwks";

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

function sequencedFetch(responses, calls = []) {
  let index = 0;
  return async (url, options) => {
    calls.push({ url, options });
    const response = responses[index++];
    if (response instanceof Error) throw response;
    if (!response) throw new Error("unexpected_fetch");
    return response;
  };
}

async function createSignedToken(keyPair, kid = "trusted-key-1", overrides = {}) {
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid });
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
    jti: "test-jti-unique-001",
    run_id: "987654321",
    run_attempt: "1",
    iat: now - 10,
    nbf: now - 10,
    exp: now + 300,
    ...overrides,
  };
  const payload = encodeJson(claims);
  const signingInput = header + "." + payload;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return signingInput + "." + encodeBase64Url(new Uint8Array(signature));
}

async function createKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
}

async function jwksFor(keyPair, kid = "trusted-key-1") {
  return {
    keys: [{
      ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
      kid,
      use: "sig",
      alg: "RS256",
    }],
  };
}

function trustedResponses(jwks) {
  return [
    jsonResponse({ issuer, jwks_uri: jwksUrl }),
    jsonResponse(jwks),
  ];
}

test("verifies a real RS256 token using only the pinned GitHub JWKS endpoints", async () => {
  const keyPair = await createKeyPair();
  const token = await createSignedToken(keyPair);
  const calls = [];
  const result = await verifyGitHubActionsOidcTokenWithTrustedJwks(token, {
    expected,
    nowSeconds: now,
    fetchImpl: sequencedFetch(trustedResponses(await jwksFor(keyPair)), calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.identity.repositoryId, expected.repositoryId);
  assert.equal(result.identity.repositoryOwnerId, expected.repositoryOwnerId);
  assert.equal(result.identity.workflowRef, expected.workflowRef);
  assert.equal(result.identity.jti, "test-jti-unique-001");
  assert.deepEqual(calls.map((call) => call.url), [discoveryUrl, jwksUrl]);
  assert.ok(calls.every((call) => call.options.redirect === "error"));
});

test("rejects a modified signature even when the key id exists in trusted JWKS", async () => {
  const keyPair = await createKeyPair();
  const token = await createSignedToken(keyPair);
  const parts = token.split(".");
  parts[2] = encodeBase64Url(new Uint8Array(256).fill(7));

  const result = await verifyGitHubActionsOidcTokenWithTrustedJwks(parts.join("."), {
    expected,
    nowSeconds: now,
    fetchImpl: sequencedFetch(trustedResponses(await jwksFor(keyPair))),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "oidc_signature_invalid");
});

test("rejects unknown signing key ids and never accepts caller-selected JWKS URLs", async () => {
  const keyPair = await createKeyPair();
  const token = await createSignedToken(keyPair, "untrusted-key-id");
  const result = await verifyGitHubActionsOidcTokenWithTrustedJwks(token, {
    expected,
    nowSeconds: now,
    fetchImpl: sequencedFetch(trustedResponses(await jwksFor(keyPair))),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "oidc_signing_key_unavailable");
});

test("fails closed when GitHub discovery is unavailable or points outside the pinned issuer", async () => {
  const unavailable = await verifyGitHubActionsOidcTokenWithTrustedJwks("invalid", {
    expected,
    nowSeconds: now,
    fetchImpl: sequencedFetch([new Error("network")]),
  });
  assert.deepEqual(unavailable, { ok: false, error: "oidc_discovery_unavailable" });

  const tampered = await verifyGitHubActionsOidcTokenWithTrustedJwks("invalid", {
    expected,
    nowSeconds: now,
    fetchImpl: sequencedFetch([jsonResponse({
      issuer,
      jwks_uri: "https://attacker.invalid/jwks",
    })]),
  });
  assert.deepEqual(tampered, { ok: false, error: "oidc_discovery_untrusted" });
});
