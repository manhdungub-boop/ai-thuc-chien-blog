import { planTaskSimulation } from "./simulation-planner.mjs";

const DEFAULT_MAX_STEPS = 5;
const HARD_MAX_STEPS = 5;

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length &&
    actual.every((key, index) => key === allowed[index]);
}

function freezeResult(result) {
  for (const step of result.steps) Object.freeze(step);
  Object.freeze(result.steps);
  Object.freeze(result.sideEffects);
  return Object.freeze(result);
}

function blocked(reason, taskType = null) {
  return freezeResult({
    ok: false,
    mode: "executor_simulation",
    execution: "not_started",
    dispatchCount: 0,
    blocked: true,
    reason,
    taskType,
    steps: [],
    sideEffects: [],
  });
}

/**
 * Produces a bounded dry-run trace from the allowlisted task planner.
 * It never invokes task handlers, State Store, queues, network, storage,
 * timers, filesystem, publishers, or the Worker /run route.
 */
export function simulateExecutorRun(taskInput, {
  controlSnapshot,
  limits = { maxSteps: DEFAULT_MAX_STEPS },
} = {}) {
  if (!isPlainRecord(limits) || !exactKeys(limits, ["maxSteps"]) ||
      !Number.isSafeInteger(limits.maxSteps) ||
      limits.maxSteps < 1 || limits.maxSteps > HARD_MAX_STEPS) {
    return blocked("executor_simulation_limits_invalid");
  }

  const plan = planTaskSimulation(taskInput, controlSnapshot);
  if (!plan.ok || plan.blocked) {
    return blocked(plan.reason, plan.taskType);
  }

  if (plan.steps.length > limits.maxSteps) {
    return blocked("executor_simulation_step_budget_exceeded", plan.taskType);
  }

  return freezeResult({
    ok: true,
    mode: "executor_simulation",
    execution: "not_started",
    dispatchCount: 0,
    blocked: false,
    reason: null,
    taskType: plan.taskType,
    steps: plan.steps.map((action, index) => ({
      index,
      action,
      status: "not_started",
    })),
    sideEffects: [],
  });
}
