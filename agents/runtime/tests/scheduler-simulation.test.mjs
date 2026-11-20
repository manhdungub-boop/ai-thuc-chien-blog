import test from "node:test";
import assert from "node:assert/strict";
import { planSchedulerTick, SCHEDULER_SIMULATION_LIMITS } from "../src/scheduler-simulation.mjs";

const ACTIVE = Object.freeze({ paused: false, emergencyStopped: false });
const TASKS = [
  { type: "content.review", idempotencyKey: "content-review-schedule-0001", payload: { articlePath: "articles/agent-runtime-safety.html" } },
  { type: "ai_bank.candidate_review", idempotencyKey: "ai-bank-schedule-000001", payload: { candidateId: "candidate_123" } },
  { type: "seo.audit", idempotencyKey: "seo-audit-schedule-000001", payload: { path: "/guides/agents" } },
];

test("scheduler simulation orders due entries stably and leaves future entries queued", () => {
  const entries = [
    { task: TASKS[0], scheduledAt: 200 },
    { task: TASKS[1], scheduledAt: 100 },
    { task: TASKS[2], scheduledAt: 300 },
    { task: { ...TASKS[0], idempotencyKey: "content-review-schedule-0002" }, scheduledAt: 100 },
  ];
  const result = planSchedulerTick(entries, { now: 200, controlSnapshot: ACTIVE });
  assert.equal(result.ok, true);
  assert.equal(result.execution, "not_started");
  assert.equal(result.dueCount, 3);
  assert.equal(result.plannedCount, 3);
  assert.equal(result.futureCount, 1);
  assert.deepEqual(result.items.map((item) => item.queueIndex), [1, 3, 0]);
  assert.deepEqual(result.sideEffects, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.items));
  assert.ok(result.items.every((item) => Object.isFrozen(item) && Object.isFrozen(item.steps)));
});

test("scheduler simulation enforces per-tick dispatch budget and reports deferred due work", () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    task: { ...TASKS[index % TASKS.length], idempotencyKey: `scheduler-budget-key-${String(index).padStart(4, "0")}` },
    scheduledAt: 100 + index,
  }));
  const result = planSchedulerTick(entries, { now: 999, maxDispatch: 2, controlSnapshot: ACTIVE });
  assert.equal(result.dueCount, 6);
  assert.equal(result.items.length, 2);
  assert.equal(result.plannedCount, 2);
  assert.equal(result.deferredDueCount, 4);
  assert.equal(result.futureCount, 0);
  assert.equal(SCHEDULER_SIMULATION_LIMITS.maxDispatchPerTick, 5);
});

test("scheduler simulation propagates Pause and Emergency Stop without planning steps", () => {
  for (const control of [
    { paused: true, emergencyStopped: false },
    { paused: false, emergencyStopped: true },
  ]) {
    const result = planSchedulerTick(
      [{ task: TASKS[0], scheduledAt: 10 }],
      { now: 10, controlSnapshot: control },
    );
    assert.equal(result.blocked, true);
    assert.equal(result.plannedCount, 0);
    assert.ok(result.items.every((item) => item.blocked && item.steps.length === 0));
    assert.deepEqual(result.sideEffects, []);
  }
});

test("scheduler simulation fails closed for invalid clocks, limits, entries, and control", () => {
  const base = { now: 10, controlSnapshot: ACTIVE };
  const cases = [
    [null, base],
    [Array.from({ length: SCHEDULER_SIMULATION_LIMITS.maxQueueEntries + 1 }, () => ({ task: TASKS[0], scheduledAt: 0 })), base],
    [[{ task: TASKS[0], scheduledAt: -1 }], base],
    [[{ task: TASKS[0], scheduledAt: 1, extra: true }], base],
    [[{ task: TASKS[0], scheduledAt: 1 }], { ...base, now: -1 }],
    [[{ task: TASKS[0], scheduledAt: 1 }], { ...base, maxDispatch: 0 }],
    [[{ task: TASKS[0], scheduledAt: 1 }], { ...base, controlSnapshot: { paused: false } }],
  ];
  for (const [entries, options] of cases) {
    const result = planSchedulerTick(entries, options);
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.execution, "not_started");
    assert.deepEqual(result.items, []);
  }
});

test("scheduler simulation does not expose payloads or executable side effects", () => {
  const result = planSchedulerTick(
    [{ task: TASKS[0], scheduledAt: 1 }],
    { now: 1, controlSnapshot: ACTIVE },
  );
  assert.equal(Object.hasOwn(result.items[0], "payload"), false);
  assert.equal(Object.hasOwn(result.items[0], "url"), false);
  assert.deepEqual(result.items[0].sideEffects, []);
});
