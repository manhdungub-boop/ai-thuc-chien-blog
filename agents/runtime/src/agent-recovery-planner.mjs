const ALLOWED_HEALTH = new Set(["healthy", "degraded", "critical", "evidence_incomplete"]);

/**
 * Produces a human/operator recovery checklist from a health evaluation.
 * It does not call Pause, Resume, lease recovery, retry, or task execution APIs.
 */
export function planAgentRecovery(health) {
  if (!health || typeof health !== "object" || Array.isArray(health) ||
      !ALLOWED_HEALTH.has(health.status) || !Array.isArray(health.issues)) {
    return Object.freeze({
      ok: false,
      status: "blocked",
      steps: Object.freeze(["obtain_valid_health_evidence"]),
      mayAutoResume: false,
      sideEffects: Object.freeze([]),
    });
  }

  let steps;
  if (health.status === "critical") {
    steps = [
      "operator_review_health_evidence",
      "manually_pause_agent_if_running",
      "inspect_state_store_and_expired_leases",
      "reconcile_task_and_audit_records",
      "rerun_scoped_validation_before_any_resume",
    ];
  } else if (health.status === "degraded" || health.status === "evidence_incomplete") {
    steps = [
      "operator_review_health_evidence",
      "collect_fresh_read_only_observations",
      "resolve_component_warnings_before_release_review",
    ];
  } else {
    steps = ["continue_read_only_observation", "keep_agent_disabled_until_separate_release_approval"];
  }

  return Object.freeze({
    ok: true,
    status: health.status === "critical" ? "manual_recovery_required"
      : health.status === "degraded" || health.status === "evidence_incomplete" ? "operator_review_required"
        : "healthy_no_recovery_action",
    steps: Object.freeze(steps),
    mayAutoResume: false,
    performsPause: false,
    performsResume: false,
    performsLeaseRecovery: false,
    executesTasks: false,
    sideEffects: Object.freeze([]),
  });
}

export const AGENT_RECOVERY_POLICY = Object.freeze({
  automaticPause: false,
  automaticResume: false,
  automaticRetry: false,
  mutatesTaskState: false,
  executesTasks: false,
});
