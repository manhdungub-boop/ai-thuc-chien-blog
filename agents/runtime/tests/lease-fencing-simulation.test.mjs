import test from "node:test";
import assert from "node:assert/strict";
import { planLeaseFenceDecision } from "../src/lease-fencing-simulation.mjs";

const OWNER_A = "a1b2c3d4-e5f6-4711-8123-abcdef012345";
const OWNER_B = "b1b2c3d4-e5f6-4711-8123-abcdef012345";
const ACTIVE = Object.freeze({ paused: false, emergencyStopped: false });

function row(overrides = {}) {
  return {
    state: "running",
    lease_owner: OWNER_A,
    lease_generation: 2,
    lease_expires_at: 20_000,
    lease_max_expires_at: 40_000,
    ...overrides,
  };
}

function heartbeat(overrides = {}) {
  return {
    operation: "heartbeat",
    row: row(),
    now: 10_000,
    leaseOwner: OWNER_A,
    leaseGeneration: 2,
    ...overrides,
  };
}

function complete(overrides = {}) {
  return {
    operation: "complete",
    row: row(),
    now: 10_000,
    leaseOwner: OWNER_A,
    leaseGeneration: 2,
    status: "succeeded",
    ...overrides,
  };
}

test("current unexpired owner and generation can extend a lease within its hard cap", () => {
  const result = planLeaseFenceDecision(heartbeat(), { controlSnapshot: ACTIVE });
  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.equal(result.plannedState, "running");
  assert.equal(result.leaseExpiresAt, 40_000);
  assert.equal(result.execution, "not_started");
  assert.equal(result.persistence, "not_started");
  assert.deepEqual(result.sideEffects, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.sideEffects));
});

test("stale owner and stale generation are rejected by the fencing policy", () => {
  const staleOwner = planLeaseFenceDecision(
    heartbeat({ leaseOwner: OWNER_B }),
    { controlSnapshot: ACTIVE },
  );
  const staleGeneration = planLeaseFenceDecision(
    heartbeat({ leaseGeneration: 1 }),
    { controlSnapshot: ACTIVE },
  );
  assert.equal(staleOwner.accepted, false);
  assert.equal(staleOwner.reason, "lease_fencing_conflict");
  assert.equal(staleGeneration.accepted, false);
  assert.equal(staleGeneration.reason, "lease_fencing_conflict");
});

test("expired heartbeat and completion are rejected", () => {
  const expiredRow = row({ lease_expires_at: 9_999 });
  const heartbeatResult = planLeaseFenceDecision(
    heartbeat({ row: expiredRow, now: 10_000 }),
    { controlSnapshot: ACTIVE },
  );
  const completionResult = planLeaseFenceDecision(
    complete({ row: expiredRow, now: 10_000 }),
    { controlSnapshot: ACTIVE },
  );
  assert.equal(heartbeatResult.accepted, false);
  assert.equal(heartbeatResult.reason, "lease_expired");
  assert.equal(completionResult.accepted, false);
  assert.equal(completionResult.reason, "lease_expired");
});

test("completion is accepted only for the current live fencing identity", () => {
  const result = planLeaseFenceDecision(complete(), { controlSnapshot: ACTIVE });
  assert.equal(result.accepted, true);
  assert.equal(result.plannedState, "succeeded");
  assert.equal(result.leaseExpiresAt, null);
  assert.deepEqual(result.sideEffects, []);
});

test("same terminal completion is idempotently recognized without persistence", () => {
  const terminalRow = row({
    state: "succeeded",
    lease_owner: null,
    lease_expires_at: null,
    lease_max_expires_at: null,
  });
  const result = planLeaseFenceDecision(
    complete({ row: terminalRow }),
    { controlSnapshot: ACTIVE },
  );
  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, "duplicate_terminal_completion");
  assert.equal(result.plannedState, "succeeded");
  assert.equal(result.persistence, "not_started");
  assert.deepEqual(result.sideEffects, []);
});

test("conflicting terminal completion is rejected", () => {
  const terminalRow = row({
    state: "succeeded",
    lease_owner: null,
    lease_expires_at: null,
    lease_max_expires_at: null,
  });
  const result = planLeaseFenceDecision(
    complete({ row: terminalRow, status: "cancelled" }),
    { controlSnapshot: ACTIVE },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "terminal_state_conflict");
});

test("Pause and Emergency Stop block heartbeat and completion decisions", () => {
  for (const controlSnapshot of [
    { paused: true, emergencyStopped: false },
    { paused: false, emergencyStopped: true },
  ]) {
    for (const input of [heartbeat(), complete()]) {
      const result = planLeaseFenceDecision(input, { controlSnapshot });
      assert.equal(result.ok, true);
      assert.equal(result.blocked, true);
      assert.equal(result.accepted, false);
      assert.deepEqual(result.sideEffects, []);
    }
  }
});

test("malformed inputs, row fields and terminal states fail closed", () => {
  const cases = [
    [null, ACTIVE],
    [{ ...heartbeat(), extra: true }, ACTIVE],
    [heartbeat({ leaseGeneration: 0 }), ACTIVE],
    [heartbeat({ row: row({ extra: true }) }), ACTIVE],
    [complete({ status: "running" }), ACTIVE],
    [complete({ status: "failed" }), ACTIVE],
    [complete({ status: "succeeded", errorCode: "not-allowed" }), ACTIVE],
    [heartbeat(), { paused: false }],
  ];
  for (const [input, controlSnapshot] of cases) {
    const result = planLeaseFenceDecision(input, { controlSnapshot });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.accepted, false);
    assert.equal(result.execution, "not_started");
    assert.deepEqual(result.sideEffects, []);
  }
});
