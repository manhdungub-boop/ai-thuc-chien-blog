import { describe, expect, it } from "vitest";
import { handleGoogleReviewerAuth, verifyGoogleReviewerSessionToken } from "../src/google-reviewer-oauth.mjs";

const now = Date.parse("2026-11-19T12:00:00.000Z");
const origin = "https://ai-thuc-chien-agent-runtime-preview.test-account.workers.dev";
const env = {
  AGENT_REVIEWER_AUTH_ENABLED: "true",
  GOOGLE_REVIEWER_CLIENT_ID: "preview-test-client-id-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com",
  GOOGLE_REVIEWER_CLIENT_SECRET: "test-google-client-secret-value-abcdefghijklmnopqrstuvwxyz0123456789",
  GOOGLE_REVIEWER_REDIRECT_URI: origin + "/auth/google/callback",
  GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com",
  GOOGLE_REVIEWER_STATE_SECRET: "state-secret-for-tests-only-abcdefghijklmnopqrstuvwxyz0123456789",
  GOOGLE_REVIEWER_SESSION_SECRET: "session-secret-for-tests-only-zyxwvutsrqponmlkjihgfedcba9876543210",
  AGENT_REVIEWER_AUTH_STORE: {
    getByName() {
      return {
        createTransaction: async () => ({ created: true }),
        consumeTransaction: async () => null
      };
    }
  }
};

describe("Google reviewer OAuth session flow", () => {
  it("fails closed when reviewer auth is disabled or secrets are missing", async () => {
    const disabled = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/start"),
      { ...env, AGENT_REVIEWER_AUTH_ENABLED: "false" },
      { now }
    );
    const incomplete = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/start"),
      { ...env, GOOGLE_REVIEWER_SESSION_SECRET: "" },
      { now }
    );
    expect(disabled.status).toBe(503);
    expect(incomplete.status).toBe(503);
    expect(await disabled.json()).toMatchObject({ error: "reviewer_auth_not_configured" });
  });

  it("starts a server-bound authorization-code flow with nonce and S256 PKCE", async () => {
    let stored;
    const testEnv = {
      ...env,
      AGENT_REVIEWER_AUTH_STORE: {
        getByName() {
          return {
            createTransaction: async (...args) => {
              stored = args;
              return { created: true };
            }
          };
        }
      }
    };
    const response = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/start"),
      testEnv,
      { now }
    );
    const location = new URL(response.headers.get("location"));
    expect(response.status).toBe(302);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.pathname).toBe("/o/oauth2/v2/auth");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("openid email");
    expect(location.searchParams.get("redirect_uri")).toBe(env.GOOGLE_REVIEWER_REDIRECT_URI);
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
    expect(location.searchParams.get("nonce")).toBeTruthy();
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(stored).toHaveLength(5);
    expect(stored[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored[2]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored[3]).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it("consumes a browser-bound login transaction once and rejects replay", async () => {
    let transaction = null;
    let consumed = false;
    const testEnv = {
      ...env,
      AGENT_REVIEWER_AUTH_STORE: {
        getByName() {
          return {
            createTransaction: async (stateHash, browserHash, nonce, codeVerifier, createdAt) => {
              transaction = { stateHash, browserHash, nonce, code_verifier: codeVerifier, created_at: createdAt, expires_at: createdAt + 300 };
              return { created: true };
            },
            consumeTransaction: async (stateHash, browserHash, nowSeconds) => {
              if (!transaction || consumed || transaction.stateHash !== stateHash ||
                  transaction.browserHash !== browserHash || transaction.expires_at <= nowSeconds) return null;
              consumed = true;
              return { nonce: transaction.nonce, code_verifier: transaction.code_verifier };
            }
          };
        }
      }
    };
    const start = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/start"),
      testEnv,
      { now }
    );
    const location = new URL(start.headers.get("location"));
    const setCookie = start.headers.get("set-cookie").split(";")[0];
    const callbackUrl = origin + "/auth/google/callback?state=" +
      encodeURIComponent(location.searchParams.get("state")) + "&code=valid-test-code";
    const first = await handleGoogleReviewerAuth(
      new Request(callbackUrl, { headers: { cookie: setCookie } }),
      testEnv,
      { now, fetchImpl: async () => { throw new Error("mock token exchange failure after transaction consumption"); } }
    );
    const replay = await handleGoogleReviewerAuth(
      new Request(callbackUrl, { headers: { cookie: setCookie } }),
      testEnv,
      { now, fetchImpl: async () => { throw new Error("replayed transaction must not reach Google"); } }
    );
    expect(first.status).toBe(502);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "login_transaction_missing_or_replayed" });
    expect(consumed).toBe(true);
  });

  it("completes the Google callback with one-time state, PKCE, signed OIDC identity, and an HMAC session", async () => {
    let stored = null;
    let consumed = false;
    const testEnv = {
      ...env,
      AGENT_REVIEWER_AUTH_STORE: {
        getByName() {
          return {
            createTransaction: async (...args) => {
              stored = args;
              return { created: true };
            },
            consumeTransaction: async (stateHash, browserHash, nowSeconds) => {
              if (!stored || consumed || stateHash !== stored[0] || browserHash !== stored[1] ||
                  nowSeconds >= stored[4] + 300) return null;
              consumed = true;
              return { nonce: stored[2], code_verifier: stored[3] };
            }
          };
        }
      }
    };

    const start = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/start"),
      testEnv,
      { now }
    );
    const authorization = new URL(start.headers.get("location"));
    const transactionCookie = start.headers.get("set-cookie").split(";")[0];
    const keyPair = await crypto.subtle.generateKey({
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    }, true, ["sign", "verify"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const encode = bytes => {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
    };
    const encodeJson = value => encode(new TextEncoder().encode(JSON.stringify(value)));
    const header = encodeJson({ alg: "RS256", typ: "JWT", kid: "preview-test-key" });
    const claims = encodeJson({
      iss: "https://accounts.google.com",
      aud: env.GOOGLE_REVIEWER_CLIENT_ID,
      sub: "google-subject-e2e-123",
      email: "reviewer@example.com",
      email_verified: true,
      nonce: authorization.searchParams.get("nonce"),
      iat: Math.floor(now / 1000) - 10,
      exp: Math.floor(now / 1000) + 300
    });
    const signingInput = header + "." + claims;
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      keyPair.privateKey,
      new TextEncoder().encode(signingInput)
    );
    const idToken = signingInput + "." + encode(new Uint8Array(signature));
    const calls = [];
    const fetchImpl = async (input, init = {}) => {
      calls.push({ url: String(input), method: init.method || "GET", body: init.body });
      if (String(input) === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(init.body);
        expect(body.get("code")).toBe("preview-test-code");
        expect(body.get("code_verifier")).toBe(stored[3]);
        expect(body.get("redirect_uri")).toBe(env.GOOGLE_REVIEWER_REDIRECT_URI);
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (String(input) === "https://www.googleapis.com/oauth2/v3/certs") {
        return new Response(JSON.stringify({
          keys: [{ ...publicJwk, kid: "preview-test-key", use: "sig", alg: "RS256" }]
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error("unexpected_upstream_request");
    };
    const callbackUrl = origin + "/auth/google/callback?state=" +
      encodeURIComponent(authorization.searchParams.get("state")) + "&code=preview-test-code";
    const callback = await handleGoogleReviewerAuth(
      new Request(callbackUrl, { headers: { cookie: transactionCookie } }),
      testEnv,
      { now, fetchImpl }
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(origin + "/");
    expect(calls.map(call => call.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/oauth2/v3/certs"
    ]);
    expect(consumed).toBe(true);
    const cookies = callback.headers.getSetCookie();
    const sessionCookie = cookies.find(value => value.startsWith("__Host-ai_reviewer_session="));
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(cookies.some(value => value.startsWith("__Host-ai_reviewer_tx=") && value.includes("Max-Age=0"))).toBe(true);
    const sessionToken = sessionCookie.split(";")[0].slice("__Host-ai_reviewer_session=".length);
    const verified = await verifyGoogleReviewerSessionToken(sessionToken, testEnv, now);
    expect(verified).toMatchObject({
      authenticated: true,
      reviewer: {
        provider: "google",
        subject: "google-subject-e2e-123",
        email: "reviewer@example.com",
        reviewer_ref: "google:google-subject-e2e-123"
      }
    });

    const me = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/me", {
        headers: { cookie: "__Host-ai_reviewer_session=" + sessionToken }
      }),
      testEnv,
      { now }
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      authenticated: true,
      reviewer: { email: "reviewer@example.com" },
      publication_authorized: false
    });
  });

  it("does not authenticate a missing session", async () => {
    const response = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/me"),
      env,
      { now }
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ authenticated: false });
  });

  it("rejects cross-origin reviewer session and logout requests", async () => {
    for (const path of ["/auth/google/me", "/auth/google/logout"]) {
      const response = await handleGoogleReviewerAuth(
        new Request(origin + path, { headers: { origin: "https://attacker.example" } }),
        env,
        { now }
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "origin_mismatch" });
    }
  });

  it("clears reviewer and transaction cookies on same-origin logout", async () => {
    const response = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/logout", { headers: { origin } }),
      env,
      { now }
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every(value => value.includes("Max-Age=0") && value.includes("Secure") && value.includes("HttpOnly"))).toBe(true);
  });

  it("accepts only an unexpired HMAC session bound to the allowlisted Google subject and reviewer reference", async () => {
    const encode = bytes => {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
    };
    const makeToken = async payload => {
      const encoded = encode(new TextEncoder().encode(JSON.stringify(payload)));
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.GOOGLE_REVIEWER_SESSION_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
      return encoded + "." + encode(new Uint8Array(signature));
    };
    const base = {
      provider: "google",
      sub: "google-subject-immutable-123",
      email: "reviewer@example.com",
      reviewer_ref: "google:google-subject-immutable-123",
      iat: Math.floor(now / 1000) - 10,
      exp: Math.floor(now / 1000) + 600
    };
    const valid = await verifyGoogleReviewerSessionToken(await makeToken(base), env, now);
    const expired = await verifyGoogleReviewerSessionToken(await makeToken({ ...base, exp: Math.floor(now / 1000) - 1 }), env, now);
    const mismatched = await verifyGoogleReviewerSessionToken(await makeToken({ ...base, reviewer_ref: "google:forged" }), env, now);
    const unlisted = await verifyGoogleReviewerSessionToken(await makeToken({ ...base, email: "attacker@example.com" }), env, now);
    const futureIssued = await verifyGoogleReviewerSessionToken(await makeToken({ ...base, iat: Math.floor(now / 1000) + 61 }), env, now);
    const excessiveLifetime = await verifyGoogleReviewerSessionToken(await makeToken({
      ...base, iat: Math.floor(now / 1000) - 1, exp: Math.floor(now / 1000) + 1801
    }), env, now);
    const invalidProvider = await verifyGoogleReviewerSessionToken(await makeToken({ ...base, provider: "other" }), env, now);
    const tampered = (await makeToken(base)).replace(/.$/, char => char === "A" ? "B" : "A");
    const badSignature = await verifyGoogleReviewerSessionToken(tampered, env, now);
    expect(valid).toMatchObject({ authenticated: true, reviewer: { reviewer_ref: base.reviewer_ref, email: base.email } });
    expect(expired.authenticated).toBe(false);
    expect(mismatched.authenticated).toBe(false);
    expect(unlisted.authenticated).toBe(false);
    expect(futureIssued.authenticated).toBe(false);
    expect(excessiveLifetime.authenticated).toBe(false);
    expect(invalidProvider.authenticated).toBe(false);
    expect(badSignature.authenticated).toBe(false);
  });


  it("rejects a Production Worker callback URL even when all other OAuth settings are valid", async () => {
    const response = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/start"),
      {
        ...env,
        GOOGLE_REVIEWER_REDIRECT_URI: "https://ai-thuc-chien-blog.manhdungub.workers.dev/auth/google/callback"
      },
      { now }
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "reviewer_auth_not_configured" });
  });

});
