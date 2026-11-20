import { evaluateAgentBudget } from "./agent-budget-guard.mjs";
import { evaluateAgentSafetySnapshot } from "./agent-safety-supervisor.mjs";

/**
 * Dry-run admission decision. It never reserves capacity, persists work, or executes tasks.
 * Caller-supplied usage evidence is accepted only as a validated, fresh, explicit free-plan
 * claim; it is not independently authenticated and must not be treated as a billing guarantee.
 */
export function evaluateRuntimeAdmission({ safetySnapshot, usageEvidence, budgetLedger, requests } = {}) {
  const blockers = [];
  const safety = evaluateAgentSafetySnapshot(safetySnapshot);
  if (!safety.ok || safety.status !== "safe_idle") blockers.push("safety_gate_not_clear");

  if (!usageEvidence || usageEvidence.ok !== true ||
      usageEvidence.validationStatus !== "valid" ||
      usageEvidence.status !== "valid_free_plan_claim" ||
      usageEvidence.plan !== "free" ||
      !Array.isArray(usageEvidence.resources) || usageEvidence.resources.length === 0 ||
      usageEvidence.executionAuthority !== false) {
    blockers.push("free_plan_usage_evidence_not_validated");
  }

  const budget = evaluateAgentBudget({ ledger: budgetLedger, requests });
  if (!budget.ok || budget.status === "blocked") blockers.push("internal_capacity_budget_blocked");
  if (budget.ok && budget.status === "partially_approved") blockers.push("some_tasks_exceed_internal_capacity");

  return Object.freeze({
    ok: blockers.length === 0,
    mode: "dry_run_admission_controller",
    status: blockers.length === 0 ? "eligible_for_separate_release_review" : "blocked",
    blockers: Object.freeze(blockers),
    safetyStatus: safety.status,
    budgetStatus: budget.status,
    approvedForReview: Object.freeze(budget.ok && blockers.length === 0 ? budget.approved : []),
    rejected: Object.freeze(budget.ok ? budget.rejected : []),
    executionStarted: false,
    reservationPersisted: false,
    sideEffects: Object.freeze([]),
    limitations: Object.freeze([
      "no_runtime_execution_or_task_enqueue",
      "usage_evidence_is_not_independently_authenticated",
      "release_review_and_deployment_are_separate_gates",
    ]),
  });
}

export const RUNTIME_ADMISSION_POLICY = Object.freeze({
  dryRunOnly: true,
  persistsReservations: false,
  enqueuesTasks: false,
  executesTasks: false,
  enablesAgent: false,
  deploys: false,
});
