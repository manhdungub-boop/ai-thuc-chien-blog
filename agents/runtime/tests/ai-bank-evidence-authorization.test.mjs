import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { authorizeAIBankEvidenceWriter } from "../src/ai-bank-evidence-authorization.mjs";

const now = Date.parse("2026-11-19T12:00:00.000Z");
const eventId = "a4e6d1c2-3b7f-4a91-8c22-1234567890ab";
const origin = "https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev";
const env = {
  AGENT_REVIEWER_AUTH_ENABLED: "true",
  GOOGLE_REVIEWER_CLIENT_ID: "preview-test-client-id-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com",
  GOOGLE_REVIEWER_CLIENT_SECRET: "test-google-client-secret-value-abcdefghijklmnopqrstuvwxyz0123456789",
  GOOGLE_REVIEWER_REDIRECT_URI: origin + "/auth/google/callback",
  GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@gmail.com",
  GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@gmail.com",
  GOOGLE_REVIEWER_STATE_SECRET: "state-secret-for-tests-only-abcdefghijklmnopqrstuvwxyz0123456789",
  GOOGLE_REVIEWER_SESSION_SECRET: "session-secret-for-tests-only-zyxwvutsrqponmlkjihgfedcba9876543210"
};
function encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
}
async function sessionToken(overrides = {}) {
  const payload = { provider: "google", sub: "google-subject-writer-123", email: "reviewer@gmail.com", reviewer_ref: "google:google-subject-writer-123", iat: Math.floor(now / 1000) - 10, exp: Math.floor(now / 1000) + 600, ...overrides };
  const encoded = encode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.GOOGLE_REVIEWER_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return encoded + "." + encode(new Uint8Array(signature));
}

describe("AI Bank evidence writer authorization", () => {
  it("fails closed when the separate writer allowlist is missing or malformed", async () => {
    const token = await sessionToken();
    for (const value of [undefined, "", "not-an-email", "reviewer@gmail.com,reviewer@gmail.com", "a@b.com,b@c.com,c@d.com,d@e.com,e@f.com,f@g.com"]) {
      const result = await authorizeAIBankEvidenceWriter(token, { ...env, GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: value }, eventId, now);
      expect(result).toEqual({ authorized: false, reason: "evidence_writer_not_configured" });
    }
  });
  it("does not promote a read-only reviewer into an evidence writer", async () => {
    expect(await authorizeAIBankEvidenceWriter(await sessionToken(), env, eventId, now)).toEqual({ authorized: false, reason: "evidence_writer_not_allowlisted" });
  });
  it("authorizes only a valid Google session with a separately allowlisted email", async () => {
    const result = await authorizeAIBankEvidenceWriter(await sessionToken(), { ...env, GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "REVIEWER@example.com" }, eventId, now);
    expect(result).toMatchObject({ authorized: true, actor: { provider: "google", subject: "google-subject-writer-123", email: "reviewer@gmail.com", reviewer_ref: "google:google-subject-writer-123" }, audit_event_id: eventId, authorized_at: "2026-11-19T12:00:00.000Z", verification_authorized: false, catalog_write_authorized: false, public_publication_authorized: false });
  });
  it("rejects expired, forged, disabled and malformed event sessions", async () => {
    const expired = await authorizeAIBankEvidenceWriter(await sessionToken({ exp: Math.floor(now / 1000) - 1 }), { ...env, GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@gmail.com" }, eventId, now);
    const disabled = await authorizeAIBankEvidenceWriter(await sessionToken(), { ...env, AGENT_REVIEWER_AUTH_ENABLED: "false", GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@gmail.com" }, eventId, now);
    const badId = await authorizeAIBankEvidenceWriter(await sessionToken(), { ...env, GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@gmail.com" }, "replay-me", now);
    expect(expired.authorized).toBe(false);
    expect(disabled).toEqual({ authorized: false, reason: "reviewer_auth_not_configured" });
    expect(badId).toEqual({ authorized: false, reason: "invalid_audit_event_id" });
  });
});
