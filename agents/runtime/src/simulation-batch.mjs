import { validateTaskRequest } from "./task-contract.mjs";
import { planTaskSimulation } from "./simulation-planner.mjs";

const MAX_BATCH_TASKS = 10;
const MAX_BATCH_STEPS = 30;

function frozenResult(result) {
  if (Array.isArray(result.items)) {
    for (const item of result.items) {
      if (Array.isArray(item.steps)) Object.freeze(item.steps);
      if (Array.isArray(item.sideEffects)) Object.freeze(item.sideEffects);
      Object.freeze(item);
    }
    Object.freeze(result.items);
  }
  return Object.freeze(result);
}

function blockedDuplicate(taskType) {
  return {
    ok: true,
    mode: "simulation",
    execution: "not_started",
    blocked: true,
    reason: "duplicate_idempotency_key_in_batch",
    taskType,
    steps: [],
    sideEffects: [],
  };
}

/**
 * Plans a bounded batch for review only.
 * No task is claimed, persisted, fetched, executed, or published.
 */
export function planSimulationBatch(taskInputs, controlSnapshot) {
  if (!Array.isArray(taskInputs) || taskInputs.length < 1) {
    return frozenResult({
      ok: false,
      mode: "simulation",
      execution: "not_started",
      blocked: true,
      reason: "batch_must_be_non_empty_array",
      items: [],
      plannedCount: 0,
      blockedCount: 0,
      plannedStepCount: 0,
      sideEffects: [],
    });
  }

  if (taskInputs.length > MAX_BATCH_TASKS) {
    return frozenResult({
      ok: false,
      mode: "simulation",
      execution: "not_started",
      blocked: true,
      reason: "batch_task_limit_exceeded",
      items: [],
      plannedCount: 0,
      blockedCount: taskInputs.length,
      plannedStepCount: 0,
      sideEffects: [],
    });
  }

  const seenKeys = new Set();
  const items = [];
  let plannedCount = 0;
  let blockedCount = 0;
  let plannedStepCount = 0;

  for (const input of taskInputs) {
    const validation = validateTaskRequest(input);
    let result;

    if (validation.ok && seenKeys.has(validation.task.idempotencyKey)) {
      result = blockedDuplicate(validation.task.type);
    } else {
      if (validation.ok) seenKeys.add(validation.task.idempotencyKey);
      result = planTaskSimulation(input, controlSnapshot);
    }

    if (result.blocked) {
      blockedCount += 1;
    } else {
      plannedCount += 1;
      plannedStepCount += result.steps.length;
    }

    items.push({
      taskType: result.taskType,
      ok: result.ok,
      blocked: result.blocked,
      reason: result.reason,
      steps: [...result.steps],
      sideEffects: [],
    });
  }

  if (plannedStepCount > MAX_BATCH_STEPS) {
    return frozenResult({
      ok: false,
      mode: "simulation",
      execution: "not_started",
      blocked: true,
      reason: "batch_step_budget_exceeded",
      items: [],
      plannedCount: 0,
      blockedCount: taskInputs.length,
      plannedStepCount: 0,
      sideEffects: [],
    });
  }

  return frozenResult({
    ok: true,
    mode: "simulation",
    execution: "not_started",
    blocked: blockedCount === taskInputs.length,
    reason: null,
    items,
    plannedCount,
    blockedCount,
    plannedStepCount,
    sideEffects: [],
  });
}

export const SIMULATION_BATCH_LIMITS = Object.freeze({
  maxTasks: MAX_BATCH_TASKS,
  maxSteps: MAX_BATCH_STEPS,
});
