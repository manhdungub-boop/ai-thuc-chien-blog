const DEFAULT_MAX_ATTEMPTS = 3;
const HARD_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const MAX_LEASE_MS = 15 * 60 * 1000;

function reject(error) { return { ok: false, error }; }
function validInteger(value, min = 0) { return Number.isSafeInteger(value) && value >= min; }
function validLeaseIdentity(owner, generation) {
  return typeof owner === "string" && /^[a-f0-9-]{16,64}$/i.test(owner) &&
    validInteger(generation, 1);
}

/** Pure claim policy. The caller must apply the returned fields atomically in SQLite. */
export function claimQueuedTask(row, {
  now,
  leaseOwner,
  leaseDurationMs = DEFAULT_LEASE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  if (!row || row.state !== "queued") return reject("task_not_queued");
  if (!validInteger(now) || !validInteger(row.attempt_count) ||
      !validInteger(row.lease_generation) || !validInteger(row.max_attempts, 1)) {
    return reject("lease_state_invalid");
  }
  if (row.next_attempt_at !== null && row.next_attempt_at !== undefined &&
      (!validInteger(row.next_attempt_at) || row.next_attempt_at > now)) {
    return reject("retry_not_due");
  }
  if (!validInteger(maxAttempts, 1) || maxAttempts > HARD_MAX_ATTEMPTS ||
      !validInteger(leaseDurationMs, 1) || leaseDurationMs > MAX_LEASE_MS) {
    return reject("lease_policy_invalid");
  }
  if (row.attempt_count >= Math.min(row.max_attempts, maxAttempts)) {
    return reject("attempt_limit_exhausted");
  }
  if (typeof leaseOwner !== "string" || !/^[a-f0-9-]{16,64}$/i.test(leaseOwner)) {
    return reject("lease_owner_invalid");
  }
  return {
    ok: true,
    fields: {
      state: "running",
      attempt_count: row.attempt_count + 1,
      lease_generation: row.lease_generation + 1,
      lease_owner: leaseOwner,
      lease_expires_at: now + leaseDurationMs,
      next_attempt_at: null,
      updated_at: now,
    },
  };
}

/** A stale or expired owner can never extend a lease. */
export function heartbeatLease(row, {
  now,
  leaseOwner,
  leaseGeneration,
  leaseDurationMs = DEFAULT_LEASE_MS,
} = {}) {
  if (!row || row.state !== "running") return reject("task_not_running");
  if (!validInteger(now) || !validInteger(row.lease_expires_at) ||
      !validLeaseIdentity(leaseOwner, leaseGeneration)) return reject("lease_request_invalid");
  if (row.lease_owner !== leaseOwner || row.lease_generation !== leaseGeneration) {
    return reject("lease_fencing_conflict");
  }
  if (row.lease_expires_at <= now) return reject("lease_expired");
  if (!validInteger(leaseDurationMs, 1) || leaseDurationMs > MAX_LEASE_MS) {
    return reject("lease_policy_invalid");
  }
  return { ok: true, fields: { lease_expires_at: now + leaseDurationMs, updated_at: now } };
}

/** Expiry recovery is bounded: requeue before max attempts, otherwise fail terminally. */
export function recoverExpiredLease(row, {
  now,
  retryDelayMs = 30_000,
} = {}) {
  if (!row || row.state !== "running") return reject("task_not_running");
  if (!validInteger(now) || !validInteger(row.lease_expires_at) ||
      !validInteger(row.attempt_count, 1) || !validInteger(row.max_attempts, 1) ||
      !validInteger(row.lease_generation, 1)) return reject("lease_state_invalid");
  if (row.lease_expires_at > now) return reject("lease_not_expired");
  if (!validInteger(retryDelayMs) || retryDelayMs > 5 * 60 * 1000) {
    return reject("retry_delay_invalid");
  }
  const clearedLease = {
    lease_owner: null,
    lease_expires_at: null,
    updated_at: now,
    last_error_code: "lease_expired",
  };
  if (row.attempt_count >= row.max_attempts) {
    return {
      ok: true,
      outcome: "failed",
      fields: { ...clearedLease, state: "failed", terminal_at: now,
        error_code: "lease_expired_max_attempts", next_attempt_at: null },
    };
  }
  return {
    ok: true,
    outcome: "requeued",
    fields: { ...clearedLease, state: "queued", terminal_at: null,
      next_attempt_at: now + retryDelayMs, error_code: null },
  };
}

/** Completion is accepted only from the current, unexpired lease generation. */
export function completeLeasedTask(row, {
  now,
  leaseOwner,
  leaseGeneration,
  status,
  errorCode,
} = {}) {
  if (!row || row.state !== "running") return reject("task_not_running");
  if (!validInteger(now) || !validInteger(row.lease_expires_at) ||
      !validLeaseIdentity(leaseOwner, leaseGeneration)) return reject("lease_request_invalid");
  if (row.lease_owner !== leaseOwner || row.lease_generation !== leaseGeneration) {
    return reject("lease_fencing_conflict");
  }
  if (row.lease_expires_at <= now) return reject("lease_expired");
  if (!["succeeded", "failed", "cancelled"].includes(status)) return reject("terminal_status_invalid");
  if (status === "failed" && (typeof errorCode !== "string" || !/^[a-z0-9_.:-]{1,64}$/.test(errorCode))) {
    return reject("error_code_invalid");
  }
  return {
    ok: true,
    fields: {
      state: status,
      updated_at: now,
      terminal_at: now,
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at: null,
      error_code: status === "failed" ? errorCode : null,
    },
  };
}

export const LEASE_POLICY_LIMITS = Object.freeze({
  defaultMaxAttempts: DEFAULT_MAX_ATTEMPTS,
  hardMaxAttempts: HARD_MAX_ATTEMPTS,
  defaultLeaseMs: DEFAULT_LEASE_MS,
  maxLeaseMs: MAX_LEASE_MS,
});
