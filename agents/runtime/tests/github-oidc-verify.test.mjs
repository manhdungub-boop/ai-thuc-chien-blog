import test from "node:test";
import assert from "node:assert/strict";
import { verifyGitHubActionsOidcToken } from "../src/github-oidc-verify.mjs";

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

const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
const jwks = { keys: [{ ...publicJwk, kid: "test-key-1", use: "sig", alg: "RS256" }] };

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signedToken(overrides = {}, headerOverrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: "test-key-1", ...headerOverrides };
  const claims = {
    iss: "https://token.actions.githubusercontent.com",
    aud: expected.audience,
    sub: "repo:" + expected.repositoryOwner + "@" + expected.repositoryOwnerId + "/" + expected.repository.slice(expected.repository.indexOf("/") + 1) + "@" + expected.repositoryId + ":ref:" + expected.ref,
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
  const encodedHeader = encodeJson(header);
  const encodedClaims = encodeJson(claims);
  const input = new TextEncoder().encode(encodedHeader + "." + encodedClaims);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, input);
  return encodedHeader + "." + encodedClaims + "." + encodeBase64Url(new Uint8Array(signature));
}

async function verify(token, options = {}) {
  return verifyGitHubActionsOidcToken(token, {
    jwks,
    expected,
    nowSeconds: now,
    ...options,
  });
}

test("accepts a valid GitHub Actions token bound to the exact repository, workflow, branch, and actor", async () => {
  const result = await verify(await signedToken());
  assert.equal(result.ok, true);
  assert.equal(result.identity.repository, expected.repository);
  assert.equal(result.identity.workflowRef, expected.workflowRef);
  assert.equal(result.identity.actorId, expected.actorId);
  assert.equal(result.identity.jti, "test-jti-unique-001");
  assert.equal(result.identity.runId, "987654321");
});

test("accepts an owner-pinned pull_request workflow using the exact Preview environment subject", async () => {
  const pushExpected = Object.freeze({
    ...expected,
    ref: "refs/pull/368/merge",
    workflowRef: "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/agent-runtime-preview-validation.yml@refs/pull/368/merge",
    eventName: "pull_request",
    environment: "agent-runtime-preview",
  });
  const pushSubject = "repo:manhdungub-boop@342528485/ai-thuc-chien-blog@1423636651:environment:agent-runtime-preview";
  const token = await signedToken({
    sub: pushSubject,
    ref: pushExpected.ref,
    workflow_ref: pushExpected.workflowRef,
    event_name: "pull_request",
  });
  const result = await verify(token, { expected: pushExpected });
  assert.equal(result.ok, true);
  assert.equal(result.identity.eventName, "pull_request");
  assert.equal(result.identity.ref, pushExpected.ref);
  assert.equal(result.identity.workflowRef, pushExpected.workflowRef);
});

test("rejects pull_request OIDC tokens without the exact environment-bound subject", async () => {
  const pushExpected = Object.freeze({
    ...expected,
    ref: "refs/pull/368/merge",
    workflowRef: "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/agent-runtime-preview-validation.yml@refs/pull/368/merge",
    eventName: "pull_request",
    environment: "agent-runtime-preview",
  });
  const token = await signedToken({
    sub: "repo:manhdungub-boop@342528485/ai-thuc-chien-blog@1423636651:ref:" + pushExpected.ref,
    ref: pushExpected.ref,
    workflow_ref: pushExpected.workflowRef,
    event_name: "push",
  });
  const result = await verify(token, { expected: pushExpected });
  assert.equal(result.ok, false);
  assert.equal(result.error, "oidc_claims_invalid");
});

test("rejects a token with a bad signature", async () => {
  const token = await signedToken();
  const parts = token.split(".");
  parts[2] = encodeBase64Url(new Uint8Array(256));
  const result = await verify(parts.join("."));
  assert.equal(result.ok, false);
  assert.equal(result.error, "oidc_signature_invalid");
});

test("rejects wrong algorithm, key URL injection, and unknown signing key", async () => {
  const wrongAlgorithm = await verify(await signedToken({}, { alg: "HS256" }));
  assert.equal(wrongAlgorithm.ok, false);
  assert.equal(wrongAlgorithm.error, "oidc_header_invalid");

  const injectedKeyUrl = await verify(await signedToken({}, { jku: "https://attacker.invalid/jwks" }));
  assert.equal(injectedKeyUrl.ok, false);
  assert.equal(injectedKeyUrl.error, "oidc_header_invalid");

  const unknownKid = await verify(await signedToken({}, { kid: "unknown-key" }));
  assert.equal(unknownKid.ok, false);
  assert.equal(unknownKid.error, "oidc_signing_key_unavailable");
});

test("rejects expired, future-issued, and excessively long-lived tokens", async () => {
  assert.equal((await verify(await signedToken({ exp: now - 1 }))).error, "oidc_claims_invalid");
  assert.equal((await verify(await signedToken({ iat: now + 120 }))).error, "oidc_claims_invalid");
  assert.equal((await verify(await signedToken({ nbf: now + 120 }))).error, "oidc_claims_invalid");
  assert.equal((await verify(await signedToken({ exp: now + 900 }))).error, "oidc_claims_invalid");
});

test("rejects audience, repository, repository ID, branch, workflow, actor, and event mismatches", async () => {
  for (const override of [
    { aud: "unexpected-audience" },
    { repository: "attacker/other-repo" },
    { repository_id: "999" },
    { repository_owner_id: "999" },
    { ref: "refs/heads/attacker" },
    { workflow_ref: "attacker/other-repo/.github/workflows/evil.yml@refs/heads/main" },
    { actor_id: "999" },
    { event_name: "pull_request" },
    { sub: "repo:attacker/other-repo:ref:refs/heads/main" },
    { sub: "repo:manhdungub-boop/ai-thuc-chien-blog:ref:refs/heads/main" },
  ]) {
    const result = await verify(await signedToken(override));
    assert.equal(result.ok, false);
    assert.equal(result.error, "oidc_claims_invalid");
  }
});

test("rejects missing replay identifier and malformed token segments", async () => {
  const noJti = await verify(await signedToken({ jti: "" }));
  assert.equal(noJti.ok, false);
  assert.equal(noJti.error, "oidc_claims_invalid");

  assert.equal((await verify("not-a-jwt")).error, "oidc_token_invalid");
  assert.equal((await verify("a.b.c.d")).error, "oidc_token_invalid");
});

test("fails closed when expected identity or trusted JWKS configuration is absent", async () => {
  assert.equal((await verify(await signedToken(), { expected: undefined })).error, "oidc_configuration_invalid");
  assert.equal((await verify(await signedToken(), { jwks: undefined })).error, "oidc_configuration_invalid");
});
