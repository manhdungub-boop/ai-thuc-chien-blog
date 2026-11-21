import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REQUIRED_SECRET_NAMES = [
  "GOOGLE_REVIEWER_CLIENT_ID",
  "GOOGLE_REVIEWER_CLIENT_SECRET",
  "GOOGLE_REVIEWER_STATE_SECRET",
  "GOOGLE_REVIEWER_SESSION_SECRET"
];
const PREVIEW_NAME = "ai-thuc-chien-agent-runtime-preview";
const PREVIEW_CALLBACK = "https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev/auth/google/callback";

function validCredential(value, min = 32, max = 4096) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function hasNoProductionBindings(config) {
  return !config.account_id &&
    !config.routes?.length &&
    !config.custom_domain &&
    !config.custom_domains?.length &&
    !config.triggers?.crons?.length &&
    !config.d1_databases?.length &&
    !config.kv_namespaces?.length &&
    !config.r2_buckets?.length &&
    !config.services?.length &&
    !config.queue_producers?.length &&
    !config.queue_consumers?.length;
}

export function inspectReviewerAuthPreviewConfig(env = {}, previewConfig = {}) {
  const missing = REQUIRED_SECRET_NAMES.filter(name => !validCredential(
    env[name],
    name === "GOOGLE_REVIEWER_CLIENT_ID" ? 32 : 32,
    name === "GOOGLE_REVIEWER_CLIENT_ID" ? 512 : 4096
  ));
  const redirectValid = env.GOOGLE_REVIEWER_REDIRECT_URI === PREVIEW_CALLBACK;
  const emails = typeof env.GOOGLE_REVIEWER_ALLOWED_EMAILS === "string"
    ? env.GOOGLE_REVIEWER_ALLOWED_EMAILS.split(",").map(value => value.trim().toLowerCase()).filter(Boolean)
    : [];
  const allowlistValid = emails.length === 1 &&
    emails[0].length <= 254 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emails[0]);
  const secretsDistinct = validCredential(env.GOOGLE_REVIEWER_STATE_SECRET) &&
    validCredential(env.GOOGLE_REVIEWER_SESSION_SECRET) &&
    env.GOOGLE_REVIEWER_STATE_SECRET !== env.GOOGLE_REVIEWER_SESSION_SECRET;
  const previewVars = previewConfig.vars || {};
  const runtimeRemainsPaused = env.AGENT_ENABLED === "false" &&
    env.AGENT_PAUSED === "true" &&
    env.AGENT_SCHEDULER_ENABLED === "false" &&
    env.AGENT_RECOVERY_ALARM_ENABLED === "false" &&
    previewVars.AGENT_ENABLED === "false" &&
    previewVars.AGENT_PAUSED === "true" &&
    previewVars.AGENT_SCHEDULER_ENABLED === "false" &&
    previewVars.AGENT_RECOVERY_ALARM_ENABLED === "false";
  const previewConfigIsolated = previewConfig.name === PREVIEW_NAME &&
    previewConfig.main === "./src/worker.mjs" &&
    previewConfig.workers_dev === true &&
    previewConfig.preview_urls === false &&
    hasNoProductionBindings(previewConfig);
  const checks = {
    required_credentials_present: missing.length === 0,
    state_and_session_secrets_distinct: secretsDistinct,
    exact_preview_callback_uri: redirectValid,
    exactly_one_reviewer_allowlisted: allowlistValid,
    reviewer_auth_remains_disabled: env.AGENT_REVIEWER_AUTH_ENABLED === "false" &&
      previewVars.AGENT_REVIEWER_AUTH_ENABLED === "false",
    agent_runtime_remains_paused: runtimeRemainsPaused,
    preview_config_isolated_without_production_routes_or_cron: previewConfigIsolated
  };
  return {
    ready_for_manual_review: Object.values(checks).every(Boolean),
    checks,
    missing_credential_names: missing,
    publication_authorized: false,
    runtime_activation_authorized: false
  };
}

async function loadPreviewConfig() {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "../wrangler.preview.jsonc");
  return JSON.parse(await readFile(path, "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const previewConfig = await loadPreviewConfig();
  const report = inspectReviewerAuthPreviewConfig(process.env, previewConfig);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.ready_for_manual_review) process.exitCode = 1;
}
