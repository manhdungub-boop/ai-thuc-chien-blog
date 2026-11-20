import test from "node:test";
import assert from "node:assert/strict";
import { simulateRuntimeCycle, RUNTIME_CYCLE_SIMULATION_LIMITS } from "../src/runtime-cycle-simulation.mjs";

const CONTROL = Object.freeze({ paused: false, emergencyStopped: false });
const OWNER = "a".repeat(32);
const TASK = {
  type: "content.review",
  idempotencyKey: "runtime-cycle-content-0001",
  payload: { articlePath: "articles/agent-runtime-safety.html" },
};
const QUEUE = [{
  scheduledAt: 100,
  task: TASK,
}];
const RECOVERY = [{
  taskId: "content-review-0001",
  row: {
    attempt_count: 1,
    lease_expires_at: 100,
    lease_generation: 1,
    max_attempts: 3,
    state: "running",
  },
}];
const FENCING = [{
  operation: "heartbeat",
  row: {
    state: "running",
    lease_owner: OWNER,
    lease_generation: 1,
    lease_expires_at: 300,
    lease_max_expires_at: 500,
  },
  now: 200,
  leaseOwner: OWNER,
  leaseGeneration: 1,
}];

test("runtime cycle composes tick, recovery and fencing simulations without side effects", () => {
  const result = simulateRuntimeCycle({
    queueEntries: QUEUE,
    recoveryEntries: RECOVERY,
    fencingInputs: FENCING,
  }, { now: 200, controlSnapshot: CONTROL });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "runtime_cycle_simulation");
  assert.equal(result.execution, "not_started");
  assert.equal(result.persistence, "not_started");
  assert.equal(result.tick.execution, "not_started");
  assert.equal(result.recovery.execution, "not_started");
  assert.equal(result.recovery.persistence, "not_started");
  assert.equal(result.fencing.decisions[0].execution, "not_started");
  assert.deepEqual(result.sideEffects, []);
  assert.deepEqual(result.tick.sideEffects, []);
  assert.deepEqual(result.recovery.sideEffects, []);
  assert.deepEqual(result.fencing.decisions[0].sideEffects, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.fencing.decisions));
});

test("Pause and Emergency Stop propagate through all three simulation stages", () => {
  for (const controlSnapshot of [
    { paused: true, emergencyStopped: false },
    { paused: false, emergencyStopped: true },
  ]) {
    const result = simulateRuntimeCycle({
      queueEntries: QUEUE,
      recoveryEntries: RECOVERY,
      fencingInputs: FENCING,
    }, { now: 200, controlSnapshot });

    assert.equal(result.ok, true);
    assert.equal(result.blocked, true);
    assert.equal(result.tick.blocked, true);
    assert.equal(result.recovery.blocked, true);
    assert.equal(result.fencing.decisions[0].blocked, true);
    assert.deepEqual(result.sideEffects, []);
  }
});

test("malformed envelopes and exceeded collection or retry limits fail closed", () => {
  const base = {
    queueEntries: [],
    recoveryEntries: [],
    fencingInputs: [],
  };
  const cases = [
    simulateRuntimeCycle(null, { now: 1, controlSnapshot: CONTROL }),
    simulateRuntimeCycle({ ...base, unexpected: true }, { now: 1, controlSnapshot: CONTROL }),
    simulateRuntimeCycle(base, null),
    simulateRuntimeCycle(base, { now: 1, controlSnapshot: CONTROL, extra: true }),
    simulateRuntimeCycle(base, { now: 1, retryDelayMs: RUNTIME_CYCLE_SIMULATION_LIMITS.maxRetryDelayMs + 1, controlSnapshot: CONTROL }),
    simulateRuntimeCycle({ ...base, queueEntries: Array(21).fill(QUEUE[0]) }, { now: 1, controlSnapshot: CONTROL }),
    simulateRuntimeCycle({ ...base, recoveryEntries: Array(11).fill(RECOVERY[0]) }, { now: 1, controlSnapshot: CONTROL }),
    simulateRuntimeCycle({ ...base, fencingInputs: Array(11).fill(FENCING[0]) }, { now: 1, controlSnapshot: CONTROL }),
  ];
  assert.ok(cases.every((result) => result.ok === false));
  assert.ok(cases.every((result) => result.execution === "not_started"));
  assert.ok(cases.every((result) => result.persistence === "not_started"));
  assert.ok(cases.every((result) => result.sideEffects.length === 0));
});

test("duplicate fencing inputs are evaluated independently but remain bounded and read-only", () => {
  const result = simulateRuntimeCycle({
    queueEntries: [],
    recoveryEntries: [],
    fencingInputs: FENCING.concat(FENCING),
  }, { now: 200, controlSnapshot: CONTROL });

  assert.equal(result.ok, true);
  assert.equal(result.fencing.decisions.length, 2);
  assert.ok(result.fencing.decisions.every((item) => item.accepted === true));
  assert.ok(result.fencing.decisions.every((item) => item.execution === "not_started"));
  assert.deepEqual(result.sideEffects, []);
});
