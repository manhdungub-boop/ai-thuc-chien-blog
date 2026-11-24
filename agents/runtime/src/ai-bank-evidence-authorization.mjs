import { verifyGoogleReviewerSessionToken } from "./google-reviewer-oauth.mjs";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseWriterAllowlist(value) {
  if (typeof value !== "string" || value.length > 1280) return null;
  const emails = value.split(",").map(item => item.trim().toLowerCase());
  if (emails.length < 1 || emails.length > 5 ||
      emails.some(email => !email || email.length > 254 || !EMAIL_PATTERN.test(email)) ||
      new Set(emails).size !== emails.length) return null;
  return new Set(emails);
}

/**
 * Independently authorizes evidence submission. A read-capable Google reviewer
 * is not implicitly an evidence writer. Call only at the Durable Object boundary.
 */
export async function authorizeAIBankEvidenceWriter(token, env, eventId, now = Date.now()) {
  const writers = parseWriterAllowlist(env?.GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS);
  if (!writers) return { authorized: false, reason: "evidence_writer_not_configured" };
  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) {
    return { authorized: false, reason: "invalid_audit_event_id" };
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    return { authorized: false, reason: "invalid_authorization_time" };
  }
  const verified = await verifyGoogleReviewerSessionToken(token, env, now);
  if (!verified.authenticated) {
    return { authorized: false, reason: verified.status || "reviewer_session_invalid" };
  }
  const email = verified.reviewer.email.toLowerCase();
  if (!writers.has(email)) {
    return { authorized: false, reason: "evidence_writer_not_allowlisted" };
  }
  return {
    authorized: true,
    actor: {
      provider: "google",
      subject: verified.reviewer.subject,
      email,
      reviewer_ref: verified.reviewer.reviewer_ref
    },
    audit_event_id: eventId.toLowerCase(),
    authorized_at: new Date(now).toISOString(),
    verification_authorized: false,
    catalog_write_authorized: false,
    public_publication_authorized: false
  };
}
