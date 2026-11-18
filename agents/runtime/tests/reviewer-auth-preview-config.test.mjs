import { describe, expect, it } from "vitest";
import { inspectReviewerAuthPreviewConfig } from "../scripts/check-reviewer-auth-preview-config.mjs";

const valid = {
  AGENT_REVIEWER_AUTH_ENABLED: "false",
  AGENT_ENABLED: "false",
  AGENT_PAUSED: "true",
  AGENT_SCHEDULE_MODE: "manual_only_no_cron",
  GOOGLE_REVIEWER_CLIENT_ID: "x".repeat(72),
  GOOGLE_REVIEWER_CLIENT_SECRET: "s".repeat(40),
  GOOGLE_REVIEWER_STATE_SECRET: "a".repeat(48),
  GOOGLE_REVIEWER_SESSION_SECRET: "b".repeat(48),
  GOOGLE_REVIEWER_REDIRECT_URI: "https://ai-thuc-chien-agent-runtime-preview.account.workers.dev/auth/google/callback",
  GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com"
};

describe("reviewer OAuth Preview configuration preflight", () => {
  it("accepts a complete isolated Preview configuration while keeping auth disabled", () => {
    expect(inspectReviewerAuthPreviewConfig(valid)).toMatchObject({
      ready_for_manual_review: true,
      checks: {
        required_secrets_present: true,
        state_and_session_secrets_distinct: true,
        preview_callback_uri_valid: true,
        exactly_one_reviewer_allowlisted: true,
        reviewer_auth_remains_disabled: true,
        agent_runtime_remains_paused: true
      },
      publication_authorized: false,
      runtime_activation_authorized: false
    });
  });

  it("reports missing secret names without revealing any values", () => {
    const report = inspectReviewerAuthPreviewConfig({
      ...valid,
      GOOGLE_REVIEWER_CLIENT_SECRET: "",
      GOOGLE_REVIEWER_SESSION_SECRET: undefined
    });
    expect(report.ready_for_manual_review).toBe(false);
    expect(report.missing_secret_names).toEqual([
      "GOOGLE_REVIEWER_CLIENT_SECRET",
      "GOOGLE_REVIEWER_SESSION_SECRET"
    ]);
    expect(JSON.stringify(report)).not.toContain("reviewer@example.com");
    expect(JSON.stringify(report)).not.toContain("a".repeat(48));
  });

  it("rejects Production callback URLs and callback URL parameters", () => {
    expect(inspectReviewerAuthPreviewConfig({
      ...valid,
      GOOGLE_REVIEWER_REDIRECT_URI: "https://ai-thuc-chien-blog.manhdungub.workers.dev/auth/google/callback"
    }).checks.preview_callback_uri_valid).toBe(false);
    expect(inspectReviewerAuthPreviewConfig({
      ...valid,
      GOOGLE_REVIEWER_REDIRECT_URI: valid.GOOGLE_REVIEWER_REDIRECT_URI + "?next=/"
    }).checks.preview_callback_uri_valid).toBe(false);
  });

  it("rejects shared signing secrets and multiple reviewer emails", () => {
    expect(inspectReviewerAuthPreviewConfig({
      ...valid,
      GOOGLE_REVIEWER_SESSION_SECRET: valid.GOOGLE_REVIEWER_STATE_SECRET
    }).checks.state_and_session_secrets_distinct).toBe(false);
    expect(inspectReviewerAuthPreviewConfig({
      ...valid,
      GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com,other@example.com"
    }).checks.exactly_one_reviewer_allowlisted).toBe(false);
  });

  it("fails closed if the Agent runtime is enabled, unpaused, or scheduled", () => {
    for (const override of [
      { AGENT_ENABLED: "true" },
      { AGENT_PAUSED: "false" },
      { AGENT_SCHEDULE_MODE: "cron" }
    ]) {
      const report = inspectReviewerAuthPreviewConfig({ ...valid, ...override });
      expect(report.ready_for_manual_review).toBe(false);
      expect(report.checks.agent_runtime_remains_paused).toBe(false);
      expect(report.runtime_activation_authorized).toBe(false);
    }
  });

  it("fails if the auth feature flag is enabled during preflight", () => {
    const report = inspectReviewerAuthPreviewConfig({
      ...valid,
      AGENT_REVIEWER_AUTH_ENABLED: "true"
    });
    expect(report.ready_for_manual_review).toBe(false);
    expect(report.checks.reviewer_auth_remains_disabled).toBe(false);
    expect(report.runtime_activation_authorized).toBe(false);
  });
});
