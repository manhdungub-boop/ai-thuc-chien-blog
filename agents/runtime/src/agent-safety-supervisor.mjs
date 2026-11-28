const REQUIRED_FLAGS = Object.freeze([
  "agentEnabled",
  "agentPaused",
  "schedulerConfigured",
  "executorConfigured",
  "productionBindingsPresent",
  "cloudflareBudgetVerified",
]);

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeIssue(code, severity) {
  return Object.freeze({ code, severity });
}

/**
 * Pure safety evaluation over a caller-supplied configuration/evidence snapshot.
 * This module does not poll services, change flags, pause workers, or trigger tasks.
 */
export function evaluateAgentSafetySnapshot(snapshot) {
  if (!isPlainRecord(snapshot)) {
    return Object.freeze({
      ok: false,
      mode: "read_only_supervisor",
      status: "evidence_incomplete",
      issues: Object.freeze([safeIssue("snapshot_invalid", "error")]),
      actions: Object.freeze(["do_not_enable_or_deploy"]),
      sideEffects: Object.freeze([]),
    });
  }

  const missing = REQUIRED_FLAGS.filter(key => typeof snapshot[key] !== "boolean");
  if (missing.length > 0) {
    return Object.freeze({
      ok: false,
      mode: "read_only_supervisor",
      status: "evidence_incomplete",
      issues: Object.freeze(missing.map(key => safeIssue("evidence_missing:" + key, "error"))),
      actions: Object.freeze(["do_not_enable_or_deploy"]),
      sideEffects: Object.freeze([]),
    });
  }

  const issues = [];
  if (snapshot.agentEnabled) issues.push(safeIssue("agent_enabled_without_release_gate", "error"));
  if (!snapshot.agentPaused) issues.push(safeIssue("agent_not_paused", "error"));
  if (snapshot.schedulerConfigured) issues.push(safeIssue("scheduler_present_before_approval", "error"));
  if (snapshot.executorConfigured) issues.push(safeIssue("executor_present_before_approval", "error"));
  if (snapshot.productionBindingsPresent) issues.push(safeIssue("production_binding_detected", "error"));
  if (!snapshot.cloudflareBudgetVerified) issues.push(safeIssue("cloudflare_budget_unverified", "warning"));

  const status = issues.some(issue => issue.severity === "error")
    ? "stop_required"
    : issues.length > 0
      ? "safe_but_unverified"
      : "safe_idle";

  return Object.freeze({
    ok: true,
    mode: "read_only_supervisor",
    status,
    issues: Object.freeze(issues),
    actions: Object.freeze(status === "safe_idle"
      ? ["remain_disabled_until_explicit_release_gate"]
      : ["do_not_enable_or_deploy", "obtain_missing_evidence"]),
    sideEffects: Object.freeze([]),
  });
}

export const AGENT_SUPERVISOR_POLICY = Object.freeze({
  requiredBooleanEvidence: REQUIRED_FLAGS,
  pollsContinuously: false,
  changesRuntimeState: false,
  canPauseRuntime: false,
  canDeploy: false,
});
