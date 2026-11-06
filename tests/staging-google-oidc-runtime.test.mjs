import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const workerSource = await readFile(new URL("../worker.mjs", import.meta.url), "utf8");
const validatorMatch = workerSource.match(/async function validateGoogleOidcIdToken[\s\S]*?\n}\s*async function beginCommunityOAuth/);
assert.ok(validatorMatch, "staging Worker must contain the Google OIDC validator");
const validatorSource = validatorMatch[0].replace(/\s*async function beginCommunityOAuth$/, "");
const validateGoogleOidcIdToken = runInNewContext(
  validatorSource + "\nvalidateGoogleOidcIdToken",
  { crypto: webcrypto, atob, TextDecoder, TextEncoder, AbortSignal, URL, JSON, Uint8Array, Error, Math, Date, validCommunityOAuthEmail: (email) => { const value = String(email || "").trim().toLowerCase(); return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : ""; }, fetch: (...args) => globalThis.fetch(...args) },
);

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const NONCE = "nonce-from-auth-request";
const originalFetch = globalThis.fetch;
let keyPair;
let jwk;
let now;

const b64url = (value) => Buffer.from(value).toString("base64url");
const jsonPart = (value) => b64url(JSON.stringify(value));

async function makeToken(overrides = {}, headerOverrides = {}, signingKey = keyPair.privateKey) {
  const header = { alg: "RS256", typ: "JWT", kid: "test-key-1", ...headerOverrides };
  const claims = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-user-123",
    email: "person@example.com",
    email_verified: true,
    name: "Test User",
    iat: now,
    exp: now + 300,
    nonce: NONCE,
    ...overrides,
  };
  const input = jsonPart(header) + "." + jsonPart(claims);
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(input),
  );
  return input + "." + b64url(new Uint8Array(signature));
}

function mockGoogleFetch({ discovery, keys = [jwk], discoveryStatus = 200, jwksStatus = 200 } = {}) {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://accounts.google.com/.well-known/openid-configuration") {
      return new Response(JSON.stringify(discovery ?? {
        issuer: "https://accounts.google.com",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      }), { status: discoveryStatus, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys }), { status: jwksStatus, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected outbound URL");
  };
}

test.before(async () => {
  keyPair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  jwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  Object.assign(jwk, { kid: "test-key-1", alg: "RS256", use: "sig" });
});

test.beforeEach(() => {
  now = Math.floor(Date.now() / 1000);
  mockGoogleFetch();
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("accepts a valid Google RS256 ID token", async () => {
  const identity = await validateGoogleOidcIdToken(await makeToken(), CLIENT_ID, NONCE);
  assert.deepEqual({ ...identity }, { sub: "google-user-123", email: "person@example.com", name: "Test User" });
});

test("accepts an optional not-before claim that is already active", async () => {
  const token = await makeToken({ nbf: now - 30 });
  const identity = await validateGoogleOidcIdToken(token, CLIENT_ID, NONCE);
  assert.equal(identity.sub, "google-user-123");
});

test("accepts an optional not-before claim at the current time", async () => {
  const token = await makeToken({ nbf: now });
  const identity = await validateGoogleOidcIdToken(token, CLIENT_ID, NONCE);
  assert.equal(identity.email, "person@example.com");
});

const invalidClaims = [
  ["wrong issuer", { iss: "https://attacker.example" }],
  ["wrong audience", { aud: "another-client" }],
  ["wrong authorized party", { aud: [CLIENT_ID, "other-client"], azp: "other-client" }],
  ["expired token", () => ({ exp: now - 1 })],
  ["future issued-at", () => ({ iat: now + 61 })],
  ["future not-before", () => ({ nbf: now + 61 })],
  ["malformed not-before", { nbf: "soon" }],
  ["issued-at older than one hour", () => ({ iat: now - 3601, exp: now + 300 })],
  ["expiry before issue", () => ({ exp: now + 10, iat: now + 20 })],
  ["missing subject", { sub: "" }],
  ["wrong nonce", { nonce: "different-nonce" }],
  ["unverified email", { email_verified: false }],
  ["invalid email", { email: "not-an-email" }],
];
for (const [label, claims] of invalidClaims) {
  test("rejects " + label, async () => {
    const token = await makeToken(typeof claims === "function" ? claims() : claims);
    await assert.rejects(() => validateGoogleOidcIdToken(token, CLIENT_ID, NONCE), /oidc_claims_invalid|oidc_email_invalid/);
  });
}

test("rejects a non-RS256 header", async () => {
  const token = await makeToken({}, { alg: "HS256" });
  await assert.rejects(() => validateGoogleOidcIdToken(token, CLIENT_ID, NONCE), /oidc_header_invalid/);
});

test("rejects an unknown signing key id", async () => {
  const token = await makeToken({}, { kid: "unknown-key" });
  await assert.rejects(() => validateGoogleOidcIdToken(token, CLIENT_ID, NONCE), /oidc_signing_key_not_found/);
});

test("rejects a tampered signature", async () => {
  const token = await makeToken();
  const parts = token.split(".");
  parts[1] = jsonPart({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "attacker", email: "person@example.com", email_verified: true, iat: now, exp: now + 300, nonce: NONCE });
  await assert.rejects(() => validateGoogleOidcIdToken(parts.join("."), CLIENT_ID, NONCE), /oidc_signature_invalid/);
});

test("rejects an untrusted JWKS URL", async () => {
  mockGoogleFetch({ discovery: { issuer: "https://accounts.google.com", jwks_uri: "https://attacker.example/keys" } });
  await assert.rejects(async () => validateGoogleOidcIdToken(await makeToken(), CLIENT_ID, NONCE), /oidc_jwks_uri_invalid/);
});

test("rejects unavailable discovery metadata", async () => {
  mockGoogleFetch({ discoveryStatus: 503 });
  await assert.rejects(async () => validateGoogleOidcIdToken(await makeToken(), CLIENT_ID, NONCE), /oidc_discovery_unavailable/);
});

test("rejects unavailable JWKS", async () => {
  mockGoogleFetch({ jwksStatus: 503 });
  await assert.rejects(async () => validateGoogleOidcIdToken(await makeToken(), CLIENT_ID, NONCE), /oidc_jwks_unavailable/);
});

test("rejects a missing nonce or malformed JWT", async () => {
  await assert.rejects(() => validateGoogleOidcIdToken("not-a-jwt", CLIENT_ID, NONCE), /oidc_jwt_malformed/);
  await assert.rejects(async () => validateGoogleOidcIdToken(await makeToken(), CLIENT_ID, ""), /oidc_token_missing/);
});
