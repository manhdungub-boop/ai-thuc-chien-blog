import { describe, expect, it } from "vitest";
import { handleGoogleReviewerAuth } from "../src/google-reviewer-oauth.mjs";

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

  it("rejects callback replay or a transaction not bound to the browser", async () => {
    const start = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/start"),
      env,
      { now }
    );
    const location = new URL(start.headers.get("location"));
    const setCookie = start.headers.get("set-cookie").split(";")[0];
    const callback = await handleGoogleReviewerAuth(
      new Request(origin + "/auth/google/callback?state=" +
        encodeURIComponent(location.searchParams.get("state")) + "&code=valid-test-code", {
          headers: { cookie: setCookie }
        }),
      env,
      { now, fetchImpl: async () => { throw new Error("token exchange must not run"); } }
    );
    expect(callback.status).toBe(400);
    expect(await callback.json()).toMatchObject({ error: "login_transaction_missing_or_replayed" });
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
});
