import { planSimulationBatch } from "./simulation-batch.mjs";

const MAX_QUEUE_ENTRIES = 20;
const MAX_DISPATCH_PER_TICK = 5;
const CONTROL_FIELDS = ["paused", "emergencyStopped"];

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validControlSnapshot(control) {
  if (!isPlainRecord(control)) return false;
  const keys = Object.keys(control).sort();
  const expected = [...CONTROL_FIELDS].sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    typeof control.paused === "boolean" &&
    typeof control.emergencyStopped === "boolean";
}

function frozenResult(result) {
  if (Array.isArray(result.items)) {
    for (const item of result.items) {
      if (Array.isArray(item.steps)) Object.freeze(item.steps);
      if (Array.isArray(item.sideEffects)) Object.freeze(item.sideEffects);
      Object.freeze(item);
    }
    Object.freeze(result.items);
  }
  if (Array.isArray(result.sideEffects)) Object.freeze(result.sideEffects);
  return Object.freeze(result);
}

function reject(reason) {
  return frozenResult({
    ok: false,
    mode: "simulation",
    execution: "not_started",
    blocked: true,
    reason,
    items: [],
    dueCount: 0,
    plannedCount: 0,
    deferredDueCount: 0,
    futureCount: 0,
    sideEffects: [],
  });
}

/**
 * Simulates one scheduler tick using caller-supplied time.
 * It does not read a clock, create timers, persist queue state, claim leases,
 * invoke handlers, or perform external side effects.
 */
export function planSchedulerTick(entries, {
  now,
  maxDispatch = 5,
  controlSnapshot,
} = {}) {
  if (!Array.isArray(entries) || entries.length > MAX_QUEUE_ENTRIES) {
    return reject("scheduler_entries_invalid_or_over_limit");
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    return reject("scheduler_now_invalid");
  }
  if (!Number.isSafeInteger(maxDispatch) ||
      maxDispatch < 1 || maxDispatch > MAX_DISPATCH_PER_TICK) {
    return reject("scheduler_dispatch_limit_invalid");
  }
  if (!validControlSnapshot(controlSnapshot)) {
    return reject("control_snapshot_invalid");
  }

  const due = [];
  let futureCount = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!isPlainRecord(entry)) return reject("scheduler_entry_invalid");
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== "scheduledAt" || keys[1] !== "task") {
      return reject("scheduler_entry_fields_invalid");
    }
    if (!Number.isSafeInteger(entry.scheduledAt) || entry.scheduledAt < 0) {
      return reject("scheduler_timestamp_invalid");
    }

    if (entry.scheduledAt <= now) {
      due.push({ task: entry.task, scheduledAt: entry.scheduledAt, queueIndex: index });
    } else {
      futureCount += 1;
    }
  }

  due.sort((left, right) =>
    left.scheduledAt - right.scheduledAt || left.queueIndex - right.queueIndex
  );

  const selected = due.slice(0, maxDispatch);
  const deferredDueCount = due.length - selected.length;

  if (selected.length === 0) {
    const blocked = controlSnapshot.paused || controlSnapshot.emergencyStopped;
    return frozenResult({
      ok: true,
      mode: "simulation",
      execution: "not_started",
      blocked,
      reason: controlSnapshot.emergencyStopped
        ? "emergency_stop_active"
        : controlSnapshot.paused ? "runtime_paused" : null,
      items: [],
      dueCount: 0,
      plannedCount: 0,
      deferredDueCount: 0,
      futureCount,
      sideEffects: [],
    });
  }

  const batch = planSimulationBatch(
    selected.map((entry) => entry.task),
    controlSnapshot,
  );

  const items = selected.map((entry, index) => ({
    queueIndex: entry.queueIndex,
    scheduledAt: entry.scheduledAt,
    taskType: batch.items[index].taskType,
    ok: batch.items[index].ok,
    blocked: batch.items[index].blocked,
    reason: batch.items[index].reason,
    steps: [...batch.items[index].steps],
    sideEffects: [],
  }));

  return frozenResult({
    ok: batch.ok,
    mode: "simulation",
    execution: "not_started",
    blocked: batch.blocked,
    reason: batch.ok ? null : batch.reason,
    items,
    dueCount: due.length,
    plannedCount: batch.plannedCount,
    deferredDueCount,
    futureCount,
    sideEffects: [],
  });
}

export const SCHEDULER_SIMULATION_LIMITS = Object.freeze({
  maxQueueEntries: MAX_QUEUE_ENTRIES,
  maxDispatchPerTick: MAX_DISPATCH_PER_TICK,
});
