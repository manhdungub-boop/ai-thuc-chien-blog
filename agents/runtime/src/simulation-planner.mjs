import { validateTaskRequest } from "./task-contract.mjs";

const CONTROL_FIELDS = Object.freeze(["paused", "emergencyStopped"]);

const SIMULATION_STEPS = Object.freeze({
  "content.review": Object.freeze([
    "resolve_article_reference",
    "check_article_metadata",
    "prepare_review_report",
  ]),
  "ai_bank.candidate_review": Object.freeze([
    "resolve_candidate_reference",
    "check_candidate_metadata",
    "prepare_candidate_review_report",
  ]),
  "seo.audit": Object.freeze([
    "resolve_site_path",
    "check_route_metadata",
    "prepare_seo_audit_report",
  ]),
});

function validControlSnapshot(control) {
  if (control === null || typeof control !== "object" || Array.isArray(control)) return false;
  const prototype = Object.getPrototypeOf(control);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(control).sort();
  const expected = [...CONTROL_FIELDS].sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    typeof control.paused === "boolean" &&
    typeof control.emergencyStopped === "boolean";
}

function frozenResult(result) {
  if (Array.isArray(result.steps)) Object.freeze(result.steps);
  if (Array.isArray(result.sideEffects)) Object.freeze(result.sideEffects);
  return Object.freeze(result);
}

/**
 * Builds a deterministic, side-effect-free execution plan for review.
 * It never calls the State Store, network, filesystem, queues, or publishers.
 * This is a simulation boundary, not an Executor and not an authorization to run.
 */
export function planTaskSimulation(taskInput, controlSnapshot) {
  const validation = validateTaskRequest(taskInput);
  if (!validation.ok) {
    return frozenResult({
      ok: false,
      mode: "simulation",
      execution: "not_started",
      blocked: true,
      reason: "task_invalid:" + validation.error,
      taskType: null,
      steps: [],
      sideEffects: [],
    });
  }

  if (!validControlSnapshot(controlSnapshot)) {
    return frozenResult({
      ok: false,
      mode: "simulation",
      execution: "not_started",
      blocked: true,
      reason: "control_snapshot_invalid",
      taskType: validation.task.type,
      steps: [],
      sideEffects: [],
    });
  }

  if (controlSnapshot.emergencyStopped) {
    return frozenResult({
      ok: true,
      mode: "simulation",
      execution: "not_started",
      blocked: true,
      reason: "emergency_stop_active",
      taskType: validation.task.type,
      steps: [],
      sideEffects: [],
    });
  }

  if (controlSnapshot.paused) {
    return frozenResult({
      ok: true,
      mode: "simulation",
      execution: "not_started",
      blocked: true,
      reason: "runtime_paused",
      taskType: validation.task.type,
      steps: [],
      sideEffects: [],
    });
  }

  return frozenResult({
    ok: true,
    mode: "simulation",
    execution: "not_started",
    blocked: false,
    reason: null,
    taskType: validation.task.type,
    steps: [...SIMULATION_STEPS[validation.task.type]],
    sideEffects: [],
  });
}
