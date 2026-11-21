import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { inspectReviewerAuthPreviewConfig } from "../scripts/check-reviewer-auth-preview-config.mjs";

const previewConfig = JSON.parse(await readFile(new URL("../wrangler.preview.jsonc", import.meta.url), "utf8"));
const valid = {
  AGENT_REVIEWER_AUTH_ENABLED: "false",
  AGENT_ENABLED: "false",
  AGENT_PAUSED: "true",
  AGENT_SCHEDULER_ENABLED: "false",
  AGENT_RECOVERY_ALARM_ENABLED: "false",
  GOOGLE_REVIEWER_CLIENT_ID: "x".repeat(72),
  GOOGLE_REVIEWER_CLIENT_SECRET: "s".repeat(40),
  GOOGLE_REVIEWER_STATE_SECRET: "a".repeat(48),
  GOOGLE_REVIEWER_SESSION_SECRET: "b".repeat(48),
  GOOGLE_REVIEWER_REDIRECT_URI: "https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev/auth/google/callback",
  GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com"
};

describe("reviewer OAuth Preview configuration preflight", () => {
  it("accepts a complete isolated Preview configuration while keeping auth and runtime disabled", () => {
    expect(inspectReviewerAuthPreviewConfig(valid, previewConfig)).toMatchObject({
      ready_for_manual_review: true,
      checks: {
        required_credentials_present: true,
        state_and_session_secrets_distinct: true,
        exact_preview_callback_uri: true,
        exactly_one_reviewer_allowlisted: true,
        reviewer_auth_remains_disabled: true,
        agent_runtime_remains_paused: true,
        preview_config_isolated_without_production_routes_or_cron: true
      },
      publication_authorized: false,
      runtime_activation_authorized: false
    });
  });

  it("reports missing credential names without revealing any credential values", () => {
    const report = inspectReviewerAuthPreviewConfig({
      ...valid,
      GOOGLE_REVIEWER_CLIENT_SECRET: "",
      GOOGLE_REVIEWER_SESSION_SECRET: undefined
    }, previewConfig);
    expect(report.ready_for_manual_review).toBe(false);
    expect(report.missing_credential_names).toEqual([
      "GOOGLE_REVIEWER_CLIENT_SECRET",
      "GOOGLE_REVIEWER_SESSION_SECRET"
    ]);
    expect(JSON.stringify(report)).not.toContain("reviewer@example.com");
    expect(JSON.stringify(report)).not.toContain("a".repeat(48));
    expect(JSON.stringify(report)).not.toContain("x".repeat(72));
  });

  it("rejects Production callback URLs, alternate Preview hosts and callback parameters", () => {
    for (const redirect of [
      "https://ai-thuc-chien-blog.manhdungub.workers.dev/auth/google/callback",
      "https://ai-thuc-chien-agent-runtime-preview.other-account.workers.dev/auth/google/callback",
      valid.GOOGLE_REVIEWER_REDIRECT_URI + "?next=/"
    ]) {
      expect(inspectReviewerAuthPreviewConfig({
        ...valid,
        GOOGLE_REVIEWER_REDIRECT_URI: redirect
      }, previewConfig).checks.exact_preview_callback_uri).toBe(false);
    }
  });

  it("rejects shared signing secrets and multiple reviewer emails", () => {
    expect(inspectReviewerAuthPreviewConfig({
      ...valid,
      GOOGLE_REVIEWER_SESSION_SECRET: valid.GOOGLE_REVIEWER_STATE_SECRET
    }, previewConfig).checks.state_and_session_secrets_distinct).toBe(false);
    expect(inspectReviewerAuthPreviewConfig({
      ...valid,
      GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com,other@example.com"
    }, previewConfig).checks.exactly_one_reviewer_allowlisted).toBe(false);
  });

  it("fails closed if the runtime is enabled, unpaused, scheduled, or recovery alarms are enabled", () => {
    for (const override of [
      { AGENT_ENABLED: "true" },
      { AGENT_PAUSED: "false" },
      { AGENT_SCHEDULER_ENABLED: "true" },
      { AGENT_RECOVERY_ALARM_ENABLED: "true" }
    ]) {
      const report = inspectReviewerAuthPreviewConfig({ ...valid, ...override }, previewConfig);
      expect(report.ready_for_manual_review).toBe(false);
      expect(report.checks.agent_runtime_remains_paused).toBe(false);
      expect(report.runtime_activation_authorized).toBe(false);
    }
  });

  it("fails if reviewer auth is enabled during preflight", () => {
    const report = inspectReviewerAuthPreviewConfig({
      ...valid,
      AGENT_REVIEWER_AUTH_ENABLED: "true"
    }, previewConfig);
    expect(report.ready_for_manual_review).toBe(false);
    expect(report.checks.reviewer_auth_remains_disabled).toBe(false);
    expect(report.runtime_activation_authorized).toBe(false);
  });

  it("fails if Preview config gains a Production route or Cron trigger", () => {
    const routed = inspectReviewerAuthPreviewConfig(valid, {
      ...previewConfig,
      routes: ["ai-thuc-chien-blog.manhdungub.workers.dev/*"]
    });
    const scheduled = inspectReviewerAuthPreviewConfig(valid, {
      ...previewConfig,
      triggers: { crons: ["*/5 * * * *"] }
    });
    expect(routed.checks.preview_config_isolated_without_production_routes_or_cron).toBe(false);
    expect(scheduled.checks.preview_config_isolated_without_production_routes_or_cron).toBe(false);
  });
});
