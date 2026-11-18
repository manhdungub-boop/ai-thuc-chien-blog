import { describe, expect, it } from "vitest";
import { handleGoogleReviewerAuth, verifyGoogleReviewerSessionToken } from "../src/google-reviewer-oauth.mjs";

const now = Date.parse("2026-11-19T12:00:00.000Z");
const origin = "https://preview-agent.example.workers.dev";
const env = {
  AGENT_REVIEWER_AUTH_ENABLED: "true",
  GOOGLE_REVIEWER_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_REVIEWER_CLIENT_SECRET: "test-google-client-secret-value-0123456789",
  GOOGLE_REVIEWER_REDIRECT_URI: origin + "/auth/google/callback",
  GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com",
  GOOGLE_REVIEWER_STATE_SECRET: "state-secret-for-tests-only-0123456789",
  GOOGLE_REVIEWER_SESSION_SECRET: "session-secret-for-tests-only-0123456789",
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

  it("does not authenticate a missing session", async () => {
    const response = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/me"),
      env,
      { now }
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ authenticated: false });
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
    expect(valid).toMatchObject({ authenticated: true, reviewer: { reviewer_ref: base.reviewer_ref, email: base.email } });
    expect(expired.authenticated).toBe(false);
    expect(mismatched.authenticated).toBe(false);
    expect(unlisted.authenticated).toBe(false);
  });

});
