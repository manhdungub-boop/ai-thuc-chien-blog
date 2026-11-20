import { planSchedulerTick } from "./scheduler-simulation.mjs";
import { simulateExecutorRun } from "./executor-simulation.mjs";

const MAX_QUEUE_ENTRIES = 20;
const MAX_DISPATCH_PER_TICK = 5;
const MAX_STEPS_PER_TASK = 5;
const OPTION_KEYS = ["controlSnapshot", "limits", "maxDispatch", "now"];

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
  for (const item of result.items) {
    if (Array.isArray(item.steps)) Object.freeze(item.steps);
    if (Array.isArray(item.sideEffects)) Object.freeze(item.sideEffects);
    if (item.executor && Array.isArray(item.executor.steps)) {
      for (const step of item.executor.steps) Object.freeze(step);
      Object.freeze(item.executor.steps);
      Object.freeze(item.executor.sideEffects);
      Object.freeze(item.executor);
    }
    Object.freeze(item);
  }
  Object.freeze(result.items);
  Object.freeze(result.sideEffects);
  return Object.freeze(result);
}

function blocked(reason) {
  return freezeResult({
    ok: false,
    mode: "runtime_tick_simulation",
    execution: "not_started",
    persistence: "not_started",
    blocked: true,
    reason,
    dueCount: 0,
    selectedCount: 0,
    plannedCount: 0,
    items: [],
    sideEffects: [],
  });
}

/**
 * Composes scheduler selection with per-task Executor dry-run traces.
 * It accepts a caller-supplied timestamp and performs no dispatch, persistence,
 * lease operation, timer, network request, storage access or publishing.
 */
export function simulateRuntimeTick(queueEntries, options = {}) {
  if (!isPlainRecord(options) ||
      Object.keys(options).some((key) => !OPTION_KEYS.includes(key))) {
    return blocked("runtime_tick_options_invalid");
  }

  let maxSteps = MAX_STEPS_PER_TASK;
  if (options.limits !== undefined) {
    if (!isPlainRecord(options.limits) ||
        !exactKeys(options.limits, ["maxSteps"])) {
      return blocked("runtime_tick_limits_invalid");
    }
    maxSteps = options.limits.maxSteps;
  }

  const { now, controlSnapshot } = options;
  const maxDispatch = options.maxDispatch === undefined ? MAX_DISPATCH_PER_TICK : options.maxDispatch;

  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(maxDispatch) || maxDispatch < 1 ||
      maxDispatch > MAX_DISPATCH_PER_TICK ||
      !Number.isSafeInteger(maxSteps) || maxSteps < 1 ||
      maxSteps > MAX_STEPS_PER_TASK) {
    return blocked("runtime_tick_limits_invalid");
  }

  if (!Array.isArray(queueEntries) || queueEntries.length > MAX_QUEUE_ENTRIES) {
    return blocked("runtime_tick_queue_invalid_or_over_limit");
  }

  const scheduled = planSchedulerTick(queueEntries, {
    now,
    maxDispatch,
    controlSnapshot,
  });

  if (!scheduled.ok || scheduled.blocked) {
    return blocked(scheduled.reason || "runtime_tick_scheduler_blocked");
  }

  const items = scheduled.items.map((scheduledItem) => {
    const queueEntry = queueEntries[scheduledItem.queueIndex];
    if (!scheduledItem.ok || !queueEntry || !isPlainRecord(queueEntry.task)) {
      return {
        queueIndex: scheduledItem.queueIndex,
        taskType: scheduledItem.taskType ?? null,
        blocked: true,
        reason: scheduledItem.reason || "runtime_tick_task_not_eligible",
        execution: "not_started",
        steps: [],
        sideEffects: [],
        executor: null,
      };
    }

    const executor = simulateExecutorRun(queueEntry.task, {
      controlSnapshot,
      limits: { maxSteps },
    });

    return {
      queueIndex: scheduledItem.queueIndex,
      taskType: scheduledItem.taskType,
      blocked: !executor.ok,
      reason: executor.reason,
      execution: "not_started",
      steps: executor.steps,
      sideEffects: [],
      executor,
    };
  });

  const plannedCount = items.filter((item) => item.executor?.ok === true).length;
  return freezeResult({
    ok: items.every((item) => !item.blocked),
    mode: "runtime_tick_simulation",
    execution: "not_started",
    persistence: "not_started",
    blocked: items.some((item) => item.blocked),
    reason: items.find((item) => item.blocked)?.reason ?? null,
    dueCount: scheduled.dueCount,
    selectedCount: scheduled.items.length,
    plannedCount,
    items,
    sideEffects: [],
  });
}
