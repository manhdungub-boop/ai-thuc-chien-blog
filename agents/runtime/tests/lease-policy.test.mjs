import test from "node:test";
import assert from "node:assert/strict";
import {
  claimQueuedTask,
  heartbeatLease,
  recoverExpiredLease,
  completeLeasedTask,
  LEASE_POLICY_LIMITS,
} from "../src/lease-policy.mjs";

const OWNER_A = "a1b2c3d4-e5f6-4711-8123-abcdef012345";
const OWNER_B = "b1b2c3d4-e5f6-4711-8123-abcdef012345";

function queued(overrides = {}) {
  return {
    state: "queued",
    attempt_count: 0,
    max_attempts: 3,
    lease_generation: 0,
    lease_owner: null,
    lease_expires_at: null,
    next_attempt_at: null,
    ...overrides,
  };
}
function running(overrides = {}) {
  return {
    ...queued(),
    state: "running",
    attempt_count: 1,
    lease_generation: 1,
    lease_owner: OWNER_A,
    lease_expires_at: 5000,
    lease_max_expires_at: 20000,
    ...overrides,
  };
}

test("claim increments attempt and fencing generation with bounded lease", () => {
  const result = claimQueuedTask(queued(), { now: 1000, leaseOwner: OWNER_A });
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, {
    state: "running",
    attempt_count: 1,
    lease_generation: 1,
    lease_owner: OWNER_A,
    lease_expires_at: 1000 + LEASE_POLICY_LIMITS.defaultLeaseMs,
    next_attempt_at: null,
    updated_at: 1000,
  });
});

test("claim rejects future retry, wrong state, exhausted attempts and oversized policy", () => {
  assert.equal(claimQueuedTask(queued({ next_attempt_at: 2000 }), {
    now: 1000, leaseOwner: OWNER_A,
  }).error, "retry_not_due");
  assert.equal(claimQueuedTask(running(), { now: 1000, leaseOwner: OWNER_B }).error, "task_not_queued");
  assert.equal(claimQueuedTask(queued({ attempt_count: 3 }), {
    now: 1000, leaseOwner: OWNER_A,
  }).error, "attempt_limit_exhausted");
  assert.equal(claimQueuedTask(queued(), {
    now: 1000, leaseOwner: OWNER_A, maxAttempts: 6,
  }).error, "lease_policy_invalid");
  assert.equal(claimQueuedTask(queued(), {
    now: 1000, leaseOwner: OWNER_A, leaseDurationMs: 16 * 60 * 1000,
  }).error, "lease_policy_invalid");
});

test("heartbeat accepts only the current owner and unexpired generation", () => {
  const accepted = heartbeatLease(running(), {
    now: 2000, leaseOwner: OWNER_A, leaseGeneration: 1,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.fields.lease_expires_at, 2000 + LEASE_POLICY_LIMITS.defaultLeaseMs);
  assert.equal(heartbeatLease(running(), {
    now: 2000, leaseOwner: OWNER_B, leaseGeneration: 1,
  }).error, "lease_fencing_conflict");
  assert.equal(heartbeatLease(running(), {
    now: 2000, leaseOwner: OWNER_A, leaseGeneration: 2,
  }).error, "lease_fencing_conflict");
  assert.equal(heartbeatLease(running({ lease_expires_at: 2000 }), {
    now: 2000, leaseOwner: OWNER_A, leaseGeneration: 1,
  }).error, "lease_expired");
});

test("heartbeat cannot extend a lease beyond its absolute maximum lifetime", () => {
  const row = running({ lease_expires_at: 29 * 60 * 1000, lease_max_expires_at: 30 * 60 * 1000 });
  const capped = heartbeatLease(row, {
    now: 29 * 60 * 1000, leaseOwner: OWNER_A, leaseGeneration: 1,
  });
  assert.equal(capped.ok, true);
  assert.equal(capped.fields.lease_expires_at, 30 * 60 * 1000);
  assert.equal(heartbeatLease(row, {
    now: 30 * 60 * 1000, leaseOwner: OWNER_A, leaseGeneration: 1,
  }).error, "lease_max_lifetime_exceeded");
});

test("expired lease is requeued only below attempt ceiling and with bounded delay", () => {
  const result = recoverExpiredLease(running(), { now: 5000, retryDelayMs: 30_000 });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "requeued");
  assert.equal(result.fields.state, "queued");
  assert.equal(result.fields.next_attempt_at, 35_000);
  assert.equal(result.fields.lease_owner, null);
  assert.equal(result.fields.lease_expires_at, null);
  assert.equal(recoverExpiredLease(running(), { now: 4999 }).error, "lease_not_expired");
  assert.equal(recoverExpiredLease(running(), { now: 5000, retryDelayMs: 5 * 60 * 1000 + 1 }).error, "retry_delay_invalid");
});

test("expired lease at max attempts becomes terminal and cannot be retried", () => {
  const result = recoverExpiredLease(running({ attempt_count: 3 }), { now: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "failed");
  assert.equal(result.fields.state, "failed");
  assert.equal(result.fields.terminal_at, 5000);
  assert.equal(result.fields.error_code, "lease_expired_max_attempts");
  assert.equal(result.fields.next_attempt_at, null);
});

test("completion requires current unexpired lease and a valid terminal state", () => {
  const completed = completeLeasedTask(running(), {
    now: 4000, leaseOwner: OWNER_A, leaseGeneration: 1, status: "succeeded",
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.fields.state, "succeeded");
  assert.equal(completed.fields.lease_owner, null);
  assert.equal(completeLeasedTask(running(), {
    now: 4000, leaseOwner: OWNER_B, leaseGeneration: 1, status: "succeeded",
  }).error, "lease_fencing_conflict");
  assert.equal(completeLeasedTask(running(), {
    now: 5000, leaseOwner: OWNER_A, leaseGeneration: 1, status: "succeeded",
  }).error, "lease_expired");
  assert.equal(completeLeasedTask(running(), {
    now: 4000, leaseOwner: OWNER_A, leaseGeneration: 1, status: "failed",
  }).error, "error_code_invalid");
});
