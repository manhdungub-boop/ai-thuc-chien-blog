import test from "node:test";
import assert from "node:assert/strict";
import {
  planLeaseRecovery,
  LEASE_RECOVERY_SIMULATION_LIMITS,
} from "../src/lease-recovery-simulation.mjs";

const ACTIVE = Object.freeze({ paused: false, emergencyStopped: false });

function entry(taskId, overrides = {}) {
  return {
    taskId,
    row: {
      state: "running",
      lease_expires_at: 5_000,
      attempt_count: 1,
      max_attempts: 3,
      lease_generation: 1,
      ...overrides,
    },
  };
}

test("expired lease below attempt ceiling produces a delayed requeue plan only", () => {
  const result = planLeaseRecovery([entry("task_001")], {
    now: 5_000,
    retryDelayMs: 30_000,
    controlSnapshot: ACTIVE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.execution, "not_started");
  assert.equal(result.persistence, "not_started");
  assert.equal(result.expiredCount, 1);
  assert.equal(result.requeueCount, 1);
  assert.equal(result.items[0].outcome, "requeue");
  assert.equal(result.items[0].plannedState, "queued");
  assert.equal(result.items[0].nextAttemptAt, 35_000);
  assert.deepEqual(result.sideEffects, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.items));
  assert.ok(Object.isFrozen(result.sideEffects));
});

test("expired lease at attempt ceiling becomes terminal in the simulation", () => {
  const result = planLeaseRecovery([
    entry("task_002", { attempt_count: 3, max_attempts: 3 }),
  ], { now: 5_000, controlSnapshot: ACTIVE });
  assert.equal(result.ok, true);
  assert.equal(result.terminalFailureCount, 1);
  assert.equal(result.items[0].outcome, "terminal_failure");
  assert.equal(result.items[0].plannedState, "failed");
  assert.equal(result.items[0].nextAttemptAt, null);
});

test("unexpired lease is reported as not due and is not changed", () => {
  const result = planLeaseRecovery([entry("task_003")], {
    now: 4_999,
    controlSnapshot: ACTIVE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.notDueCount, 1);
  assert.equal(result.expiredCount, 0);
  assert.equal(result.items[0].outcome, "not_due");
  assert.equal(result.items[0].plannedState, "running");
});

test("Pause and Emergency Stop block every recovery decision", () => {
  for (const controlSnapshot of [
    { paused: true, emergencyStopped: false },
    { paused: false, emergencyStopped: true },
  ]) {
    const result = planLeaseRecovery([entry("task_004")], {
      now: 9_000,
      controlSnapshot,
    });
    assert.equal(result.ok, true);
    assert.equal(result.blocked, true);
    assert.equal(result.items[0].outcome, "blocked");
    assert.equal(result.requeueCount, 0);
    assert.deepEqual(result.sideEffects, []);
  }
});

test("recovery simulation rejects duplicate IDs, malformed rows and oversized batches", () => {
  const cases = [
    [ [entry("task_005"), entry("task_005")], { now: 9_000, controlSnapshot: ACTIVE } ],
    [ [{ ...entry("task_006"), row: { ...entry("task_006").row, extra: true } }], { now: 9_000, controlSnapshot: ACTIVE } ],
    [ [entry("task_007", { lease_generation: 0 })], { now: 9_000, controlSnapshot: ACTIVE } ],
    [ Array.from({ length: LEASE_RECOVERY_SIMULATION_LIMITS.maxEntries + 1 }, (_, i) => entry(`task_${String(i).padStart(3, "0")}`)), { now: 9_000, controlSnapshot: ACTIVE } ],
    [ [entry("task_008")], { now: -1, controlSnapshot: ACTIVE } ],
    [ [entry("task_009")], { now: 9_000, retryDelayMs: LEASE_RECOVERY_SIMULATION_LIMITS.maxRetryDelayMs + 1, controlSnapshot: ACTIVE } ],
    [ [entry("task_010")], { now: 9_000, controlSnapshot: { paused: false } } ],
  ];
  for (const [entries, options] of cases) {
    const result = planLeaseRecovery(entries, options);
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.execution, "not_started");
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.sideEffects, []);
  }
});

test("recovery output contains no lease owner, payload or executable operation", () => {
  const result = planLeaseRecovery([entry("task_011")], {
    now: 9_000,
    controlSnapshot: ACTIVE,
  });
  assert.equal(Object.hasOwn(result.items[0], "leaseOwner"), false);
  assert.equal(Object.hasOwn(result.items[0], "payload"), false);
  assert.equal(Object.hasOwn(result.items[0], "operation"), false);
  assert.ok(Object.isFrozen(result.items[0]));
});
