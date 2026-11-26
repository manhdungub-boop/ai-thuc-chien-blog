import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { verifyGoogleReviewerIdToken } from "../src/google-oidc-reviewer-verifier.mjs";

const audience = "test-google-oauth-client.apps.googleusercontent.com";
const nonce = "one-time-login-nonce-0123456789";
const email = "manhdungub@gmail.com";
const now = Date.parse("2026-11-19T12:00:00.000Z");

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function makeKeyPair() {
  const pair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256"
  }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { ...pair, jwk: { ...jwk, kid: "test-key-1", use: "sig", alg: "RS256" } };
}

async function makeToken(pair, overrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: "test-key-1" };
  const claims = {
    iss: "https://accounts.google.com",
    aud: audience,
    sub: "google-subject-123456",
    email,
    email_verified: true,
    nonce,
    iat: Math.floor(now / 1000) - 30,
    exp: Math.floor(now / 1000) + 300,
    ...overrides
  };
  const signingInput = encodeJson(header) + "." + encodeJson(claims);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    pair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + "." + base64Url(new Uint8Array(signature));
}

function options(pair, extra = {}) {
  return {
    audience,
    nonce,
    allowedEmails: [email],
    now,
    fetchImpl: async url => {
      expect(url).toBe("https://www.googleapis.com/oauth2/v3/certs");
      return new Response(JSON.stringify({ keys: [pair.jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    ...extra
  };
}

describe("Google OIDC reviewer identity verifier", () => {
  it("authenticates a correctly signed, fresh token for the allowlisted Google account", async () => {
    const pair = await makeKeyPair();
    const token = await makeToken(pair);
    const result = await verifyGoogleReviewerIdToken(token, options(pair));
    expect(result).toMatchObject({
      ok: true,
      status: "google_reviewer_identity_authenticated",
      reviewer_identity_authenticated: true,
      reviewer: {
        provider: "google",
        subject: "google-subject-123456",
        email,
        reviewer_ref: "google:google-subject-123456"
      },
      publication_authorized: false,
      content_published: false,
      social_post_published: false
    });
  });

  it("rejects third-party email allowlists even when the ID token claims them as verified", async () => {
    const pair = await makeKeyPair();
    const token = await makeToken(pair, { email: "reviewer@example.org" });
    const result = await verifyGoogleReviewerIdToken(token, options(pair, {
      allowedEmails: ["reviewer@example.org"],
      fetchImpl: async () => { throw new Error("must_not_fetch"); }
    }));
    expect(result.status).toBe("google_oidc_allowlist_invalid");
  });

  it("rejects an untrusted email even when the token signature is valid", async () => {
    const pair = await makeKeyPair();
    const token = await makeToken(pair, { email: "other@example.com" });
    const result = await verifyGoogleReviewerIdToken(token, options(pair));
    expect(result.status).toBe("google_reviewer_not_allowlisted");
  });

  it("rejects unverified email claims", async () => {
    const pair = await makeKeyPair();
    const token = await makeToken(pair, { email_verified: false });
    const result = await verifyGoogleReviewerIdToken(token, options(pair));
    expect(result.status).toBe("google_reviewer_not_allowlisted");
  });

  it("rejects wrong audience, issuer, and nonce before requesting signing keys", async () => {
    const pair = await makeKeyPair();
    const noFetch = async () => { throw new Error("must_not_fetch"); };
    const wrongAudience = await makeToken(pair, { aud: "another-client" });
    const wrongIssuer = await makeToken(pair, { iss: "https://attacker.example" });
    const wrongNonce = await makeToken(pair, { nonce: "replayed-or-wrong-nonce" });
    expect((await verifyGoogleReviewerIdToken(wrongAudience, options(pair, { fetchImpl: noFetch }))).status)
      .toBe("google_id_token_issuer_or_audience_rejected");
    expect((await verifyGoogleReviewerIdToken(wrongIssuer, options(pair, { fetchImpl: noFetch }))).status)
      .toBe("google_id_token_issuer_or_audience_rejected");
    expect((await verifyGoogleReviewerIdToken(wrongNonce, options(pair, { fetchImpl: noFetch }))).status)
      .toBe("google_id_token_time_or_nonce_rejected");
  });

  it("rejects an ID token with a nonstandard lifetime longer than one hour", async () => {
    const pair = await makeKeyPair();
    const token = await makeToken(pair, {
      iat: Math.floor(now / 1000) - 1800,
      exp: Math.floor(now / 1000) + 2400
    });
    const result = await verifyGoogleReviewerIdToken(token, options(pair, {
      fetchImpl: async () => { throw new Error("must_not_fetch"); }
    }));
    expect(result.status).toBe("google_id_token_time_or_nonce_rejected");
  });

  it("rejects expired, future-issued, and not-yet-valid tokens", async () => {
    const pair = await makeKeyPair();
    const expired = await makeToken(pair, { exp: Math.floor(now / 1000) - 500 });
    const future = await makeToken(pair, { iat: Math.floor(now / 1000) + 500 });
    const notYetValid = await makeToken(pair, { nbf: Math.floor(now / 1000) + 500 });
    for (const token of [expired, future, notYetValid]) {
      expect((await verifyGoogleReviewerIdToken(token, options(pair, { fetchImpl: async () => { throw new Error("must_not_fetch"); } }))).status)
        .toBe("google_id_token_time_or_nonce_rejected");
    }
  });

  it("rejects forged signatures and unknown signing key IDs", async () => {
    const pair = await makeKeyPair();
    const token = await makeToken(pair);
    const other = await makeKeyPair();
    const forged = await verifyGoogleReviewerIdToken(token, options(other));
    expect(forged.status).toBe("google_id_token_signature_invalid");
    const unknownKey = await verifyGoogleReviewerIdToken(token, options(pair, {
      fetchImpl: async () => new Response(JSON.stringify({ keys: [{ ...pair.jwk, kid: "rotated-key" }] }), { status: 200, headers: { "content-type": "application/json" } })
    }));
    expect(unknownKey.status).toBe("google_signing_key_not_found");
  });

  it("rejects malformed tokens and incomplete server-side configuration", async () => {
    expect((await verifyGoogleReviewerIdToken("not.a.jwt", options({ jwk: {} }))).status)
      .toBe("google_id_token_malformed");
    expect((await verifyGoogleReviewerIdToken("a.b.c", { audience, nonce, allowedEmails: [] })).status)
      .toBe("google_oidc_configuration_invalid");
  });

  it("fails closed when Google's signing-key endpoint is unavailable", async () => {
    const pair = await makeKeyPair();
    const token = await makeToken(pair);
    const result = await verifyGoogleReviewerIdToken(token, options(pair, {
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    }));
    expect(result.status).toBe("google_jwks_unavailable");
    expect(result.reviewer_identity_authenticated).toBe(false);
  });
});
