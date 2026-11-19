import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SECRETS = [
  "GOOGLE_REVIEWER_CLIENT_ID",
  "GOOGLE_REVIEWER_CLIENT_SECRET",
  "GOOGLE_REVIEWER_STATE_SECRET",
  "GOOGLE_REVIEWER_SESSION_SECRET"
];

function validSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4096;
}

export function inspectReviewerAuthPreviewConfig(env = {}) {
  const missing = REQUIRED_SECRETS.filter(name => !validSecret(env[name]));
  const redirect = typeof env.GOOGLE_REVIEWER_REDIRECT_URI === "string"
    ? env.GOOGLE_REVIEWER_REDIRECT_URI
    : "";
  let redirectValid = false;
  try {
    const url = new URL(redirect);
    redirectValid = url.protocol === "https:" &&
      /^ai-thuc-chien-agent-runtime-preview\.[a-z0-9-]+\.workers\.dev$/i.test(url.hostname) &&
      url.pathname === "/auth/google/callback" &&
      !url.username && !url.password && !url.search && !url.hash &&
      redirect.length <= 512;
  } catch {
    redirectValid = false;
  }

  const emails = typeof env.GOOGLE_REVIEWER_ALLOWED_EMAILS === "string"
    ? env.GOOGLE_REVIEWER_ALLOWED_EMAILS.split(",").map(value => value.trim().toLowerCase()).filter(Boolean)
    : [];
  const allowlistValid = emails.length === 1 &&
    emails[0].length <= 254 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emails[0]);
  const secretsDistinct = validSecret(env.GOOGLE_REVIEWER_STATE_SECRET) &&
    validSecret(env.GOOGLE_REVIEWER_SESSION_SECRET) &&
    env.GOOGLE_REVIEWER_STATE_SECRET !== env.GOOGLE_REVIEWER_SESSION_SECRET;
  const enabledFlagValid = env.AGENT_REVIEWER_AUTH_ENABLED === "false";
  const runtimeRemainsPaused = env.AGENT_ENABLED === "false" &&
    env.AGENT_PAUSED === "true" &&
    env.AGENT_SCHEDULE_MODE === "manual_only_no_cron";

  const checks = {
    required_secrets_present: missing.length === 0,
    state_and_session_secrets_distinct: secretsDistinct,
    preview_callback_uri_valid: redirectValid,
    exactly_one_reviewer_allowlisted: allowlistValid,
    reviewer_auth_remains_disabled: enabledFlagValid,
    agent_runtime_remains_paused: runtimeRemainsPaused
  };
  return {
    ready_for_manual_review: Object.values(checks).every(Boolean),
    checks,
    missing_secret_names: missing,
    // Never return secret values, client IDs, callback URLs, or reviewer email addresses.
    publication_authorized: false,
    runtime_activation_authorized: false
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = inspectReviewerAuthPreviewConfig(process.env);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.ready_for_manual_review) process.exitCode = 1;
}
