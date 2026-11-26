import { recoverExpiredLease } from "./lease-policy.mjs";

const MAX_RECOVERY_ENTRIES = 10;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const ENTRY_FIELDS = ["row", "taskId"];
const ROW_FIELDS = [
  "attempt_count",
  "lease_expires_at",
  "lease_generation",
  "max_attempts",
  "state",
];
const CONTROL_FIELDS = ["paused", "emergencyStopped"];

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length &&
    actual.every((key, index) => key === allowed[index]);
}

function validControlSnapshot(control) {
  return isPlainRecord(control) &&
    hasExactKeys(control, CONTROL_FIELDS) &&
    typeof control.paused === "boolean" &&
    typeof control.emergencyStopped === "boolean";
}

function validRecoveryEntry(entry) {
  if (!isPlainRecord(entry) || !hasExactKeys(entry, ENTRY_FIELDS)) return false;
  if (typeof entry.taskId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.taskId)) {
    return false;
  }
  const row = entry.row;
  if (!isPlainRecord(row) || !hasExactKeys(row, ROW_FIELDS)) return false;
  return row.state === "running" &&
    Number.isSafeInteger(row.lease_expires_at) && row.lease_expires_at >= 0 &&
    Number.isSafeInteger(row.attempt_count) && row.attempt_count >= 1 &&
    Number.isSafeInteger(row.max_attempts) && row.max_attempts >= 1 &&
    Number.isSafeInteger(row.lease_generation) && row.lease_generation >= 1;
}

function freezeResult(result) {
  for (const item of result.items) Object.freeze(item);
  Object.freeze(result.items);
  Object.freeze(result.sideEffects);
  return Object.freeze(result);
}

function reject(reason) {
  return freezeResult({
    ok: false,
    mode: "simulation",
    execution: "not_started",
    persistence: "not_started",
    blocked: true,
    reason,
    items: [],
    expiredCount: 0,
    requeueCount: 0,
    terminalFailureCount: 0,
    notDueCount: 0,
    sideEffects: [],
  });
}

/**
 * Simulates recovery decisions for expired leases using the existing pure
 * lease policy. It never reads storage, claims work, writes transitions,
 * schedules retries, or invokes an executor.
 */
export function planLeaseRecovery(entries, {
  now,
  retryDelayMs = 30_000,
  controlSnapshot,
} = {}) {
  if (!Array.isArray(entries) || entries.length > MAX_RECOVERY_ENTRIES) {
    return reject("recovery_entries_invalid_or_over_limit");
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    return reject("recovery_now_invalid");
  }
  if (!Number.isSafeInteger(retryDelayMs) ||
      retryDelayMs < 0 || retryDelayMs > MAX_RETRY_DELAY_MS) {
    return reject("recovery_retry_delay_invalid");
  }
  if (!validControlSnapshot(controlSnapshot)) {
    return reject("control_snapshot_invalid");
  }

  const seen = new Set();
  for (const entry of entries) {
    if (!validRecoveryEntry(entry)) return reject("recovery_entry_invalid");
    if (seen.has(entry.taskId)) return reject("recovery_duplicate_task_id");
    seen.add(entry.taskId);
  }

  if (controlSnapshot.paused || controlSnapshot.emergencyStopped) {
    const reason = controlSnapshot.emergencyStopped
      ? "emergency_stop_active"
      : "runtime_paused";
    return freezeResult({
      ok: true,
      mode: "simulation",
      execution: "not_started",
      persistence: "not_started",
      blocked: true,
      reason,
      items: entries.map(({ taskId }) => ({
        taskId,
        outcome: "blocked",
        reason,
        plannedState: null,
        nextAttemptAt: null,
      })),
      expiredCount: 0,
      requeueCount: 0,
      terminalFailureCount: 0,
      notDueCount: 0,
      sideEffects: [],
    });
  }

  const items = [];
  let expiredCount = 0;
  let requeueCount = 0;
  let terminalFailureCount = 0;
  let notDueCount = 0;

  for (const { taskId, row } of entries) {
    const result = recoverExpiredLease(row, { now, retryDelayMs });
    if (!result.ok) {
      if (result.error === "lease_not_expired") {
        notDueCount += 1;
        items.push({
          taskId,
          outcome: "not_due",
          reason: result.error,
          plannedState: "running",
          nextAttemptAt: null,
        });
        continue;
      }
      return reject("recovery_policy_rejected:" + result.error);
    }

    expiredCount += 1;
    if (result.outcome === "requeued") {
      requeueCount += 1;
      items.push({
        taskId,
        outcome: "requeue",
        reason: "lease_expired",
        plannedState: "queued",
        nextAttemptAt: result.fields.next_attempt_at,
      });
    } else {
      terminalFailureCount += 1;
      items.push({
        taskId,
        outcome: "terminal_failure",
        reason: "lease_expired_max_attempts",
        plannedState: "failed",
        nextAttemptAt: null,
      });
    }
  }

  return freezeResult({
    ok: true,
    mode: "simulation",
    execution: "not_started",
    persistence: "not_started",
    blocked: false,
    reason: null,
    items,
    expiredCount,
    requeueCount,
    terminalFailureCount,
    notDueCount,
    sideEffects: [],
  });
}

export const LEASE_RECOVERY_SIMULATION_LIMITS = Object.freeze({
  maxEntries: MAX_RECOVERY_ENTRIES,
  maxRetryDelayMs: MAX_RETRY_DELAY_MS,
});
