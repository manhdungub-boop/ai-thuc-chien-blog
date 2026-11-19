import { describe, expect, it } from "vitest";
import { authorizeOperatorSession } from "../src/task-store.mjs";

const baseEnv = {
  AGENT_OPERATOR_CONTROL_ENABLED: "true",
  AGENT_OPERATOR_ALLOWED_EMAILS: "owner@example.com",
  AGENT_REVIEWER_AUTH_ENABLED: "true",
  GOOGLE_REVIEWER_CLIENT_ID: "test-client-id-000000000000000000000000000000",
  GOOGLE_REVIEWER_CLIENT_SECRET: "test-client-secret-000000000000000000000000000000",
  GOOGLE_REVIEWER_REDIRECT_URI: "https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev/auth/google/callback",
  GOOGLE_REVIEWER_ALLOWED_EMAILS: "owner@example.com",
  GOOGLE_REVIEWER_STATE_SECRET: "state-secret-for-operator-tests-000000000000",
  GOOGLE_REVIEWER_SESSION_SECRET: "session-secret-for-operator-tests-000000000000"
};

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
}

async function createSessionToken(env, email = "owner@example.com") {
  const now = Math.floor(Date.now() / 1000);
  const subject = "google-owner-subject-0001";
  const payload = {
    provider: "google",
    sub: subject,
    email,
    reviewer_ref: "google:" + subject,
    iat: now,
    exp: now + 900
  };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GOOGLE_REVIEWER_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded)
  ));
  return encoded + "." + base64url(signature);
}

describe("operator session authorization", () => {
  it("requires the explicit operator-control feature flag", async () => {
    const env = { ...baseEnv, AGENT_OPERATOR_CONTROL_ENABLED: "false" };
    expect(await authorizeOperatorSession("invalid", env)).toEqual({
      authorized: false,
      reason: "operator_control_disabled"
    });
  });

  it("fails closed when the dedicated operator allowlist is missing or malformed", async () => {
    for (const allowlist of [undefined, "", "not-an-email", "owner@example.com,other@example.com"]) {
      const env = { ...baseEnv, AGENT_OPERATOR_ALLOWED_EMAILS: allowlist };
      expect(await authorizeOperatorSession("invalid", env)).toEqual({
        authorized: false,
        reason: "operator_allowlist_not_configured"
      });
    }
  });

  it("accepts only a valid Google session matching both reviewer and operator allowlists", async () => {
    const token = await createSessionToken(baseEnv);
    expect(await authorizeOperatorSession(token, baseEnv)).toEqual({
      authorized: true,
      actor_ref: "google:google-owner-subject-0001"
    });
  });

  it("rejects a valid reviewer whose email is not on the separate operator allowlist", async () => {
    const env = { ...baseEnv, AGENT_OPERATOR_ALLOWED_EMAILS: "different-owner@example.com" };
    const token = await createSessionToken(env);
    expect(await authorizeOperatorSession(token, env)).toEqual({
      authorized: false,
      reason: "operator_not_allowed"
    });
  });

  it("rejects a tampered session signature", async () => {
    const token = await createSessionToken(baseEnv);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(await authorizeOperatorSession(tampered, baseEnv)).toEqual({
      authorized: false,
      reason: "operator_session_invalid"
    });
  });
});
