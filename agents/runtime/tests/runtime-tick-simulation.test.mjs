import test from "node:test";
import assert from "node:assert/strict";
import { simulateRuntimeTick } from "../src/runtime-tick-simulation.mjs";

const CONTROL = Object.freeze({ paused: false, emergencyStopped: false });
const TASK = {
  type: "content.review",
  idempotencyKey: "runtime-tick-content-0001",
  payload: { articlePath: "articles/agent-runtime-safety.html" },
};

function entry(scheduledAt, task = TASK) {
  return { scheduledAt, task };
}

test("runtime tick composes stable scheduler selection and executor dry-run traces", () => {
  const result = simulateRuntimeTick([
    entry(200, TASK),
    entry(100, { ...TASK, idempotencyKey: "runtime-tick-content-0002" }),
    entry(900, { ...TASK, idempotencyKey: "runtime-tick-content-0003" }),
  ], { now: 200, controlSnapshot: CONTROL });

  assert.equal(result.ok, true);
  assert.equal(result.execution, "not_started");
  assert.equal(result.persistence, "not_started");
  assert.equal(result.dueCount, 2);
  assert.equal(result.selectedCount, 2);
  assert.equal(result.plannedCount, 2);
  assert.deepEqual(result.items.map((item) => item.queueIndex), [1, 0]);
  assert.ok(result.items.every((item) => item.executor.ok));
  assert.ok(result.items.every((item) => item.steps.every((step) => step.status === "not_started")));
  assert.deepEqual(result.sideEffects, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.items));
});

test("Pause and Emergency Stop block the tick before any plan is emitted", () => {
  for (const controlSnapshot of [
    { paused: true, emergencyStopped: false },
    { paused: false, emergencyStopped: true },
  ]) {
    const result = simulateRuntimeTick([entry(100)], {
      now: 100,
      controlSnapshot,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.selectedCount, 0);
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.sideEffects, []);
  }
});

test("future work is not selected and dispatch remains bounded", () => {
  const queue = Array.from({ length: 8 }, (_, index) =>
    entry(100, { ...TASK, idempotencyKey: `runtime-tick-${index}-0001` }));
  queue.push(entry(500, { ...TASK, idempotencyKey: "runtime-tick-future-0001" }));
  const result = simulateRuntimeTick(queue, {
    now: 100,
    maxDispatch: 3,
    controlSnapshot: CONTROL,
  });
  assert.equal(result.ok, true);
  assert.equal(result.dueCount, 8);
  assert.equal(result.selectedCount, 3);
  assert.equal(result.plannedCount, 3);
  assert.deepEqual(result.items.map((item) => item.queueIndex), [0, 1, 2]);
});

test("invalid options, limits, queue and timestamps fail closed", () => {
  const cases = [
    simulateRuntimeTick([entry(1)], null),
    simulateRuntimeTick([entry(1)], { now: 1, controlSnapshot: CONTROL, execute: true }),
    simulateRuntimeTick([entry(1)], { now: -1, controlSnapshot: CONTROL }),
    simulateRuntimeTick([entry(1)], { now: 1, maxDispatch: 6, controlSnapshot: CONTROL }),
    simulateRuntimeTick([entry(1)], { now: 1, limits: { maxSteps: 6 }, controlSnapshot: CONTROL }),
    simulateRuntimeTick([entry(1)], { now: 1, limits: null, controlSnapshot: CONTROL }),
    simulateRuntimeTick([entry(1)], { now: 1, limits: [], controlSnapshot: CONTROL }),
    simulateRuntimeTick(Array(21).fill(entry(1)), { now: 1, controlSnapshot: CONTROL }),
  ];
  assert.ok(cases.every((result) => result.ok === false));
  assert.ok(cases.every((result) => result.execution === "not_started"));
  assert.ok(cases.every((result) => result.items.length === 0));
  assert.ok(cases.every((result) => result.sideEffects.length === 0));
});

test("duplicate idempotency keys are rejected by scheduler before executor planning", () => {
  const result = simulateRuntimeTick([
    entry(100, TASK),
    entry(100, TASK),
  ], { now: 100, controlSnapshot: CONTROL });
  assert.equal(result.ok, false);
  assert.equal(result.selectedCount, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.sideEffects, []);
});
