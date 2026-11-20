import test from "node:test";
import assert from "node:assert/strict";
import { simulateExecutorRun } from "../src/executor-simulation.mjs";

const ACTIVE = Object.freeze({ paused: false, emergencyStopped: false });
const TASKS = [
  {
    type: "content.review",
    idempotencyKey: "content-review-executor-0001",
    payload: { articlePath: "articles/agent-runtime-safety.html" },
  },
  {
    type: "ai_bank.candidate_review",
    idempotencyKey: "ai-bank-executor-0001",
    payload: { candidateId: "candidate_123" },
  },
  {
    type: "seo.audit",
    idempotencyKey: "seo-executor-0001",
    payload: { path: "/guides/agents" },
  },
];

test("executor simulation returns bounded not-started traces for allowlisted tasks", () => {
  for (const task of TASKS) {
    const result = simulateExecutorRun(task, { controlSnapshot: ACTIVE });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "executor_simulation");
    assert.equal(result.execution, "not_started");
    assert.equal(result.dispatchCount, 0);
    assert.equal(result.blocked, false);
    assert.equal(result.steps.length, 3);
    assert.ok(result.steps.every((step) => step.status === "not_started"));
    assert.deepEqual(result.sideEffects, []);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.steps));
    assert.ok(result.steps.every(Object.isFrozen));
    assert.ok(Object.isFrozen(result.sideEffects));
  }
});

test("Pause and Emergency Stop prevent even a dry-run trace", () => {
  for (const controlSnapshot of [
    { paused: true, emergencyStopped: false },
    { paused: false, emergencyStopped: true },
  ]) {
    const result = simulateExecutorRun(TASKS[0], { controlSnapshot });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.execution, "not_started");
    assert.equal(result.dispatchCount, 0);
    assert.deepEqual(result.steps, []);
    assert.deepEqual(result.sideEffects, []);
  }
});

test("invalid tasks and invalid control snapshots fail closed", () => {
  const invalidTask = simulateExecutorRun({
    type: "shell.exec",
    idempotencyKey: "executor-invalid-0001",
    payload: { command: "touch /tmp/nope" },
  }, { controlSnapshot: ACTIVE });
  const invalidControl = simulateExecutorRun(TASKS[0], {
    controlSnapshot: { paused: false },
  });
  assert.equal(invalidTask.ok, false);
  assert.match(invalidTask.reason, /^task_invalid:/);
  assert.equal(invalidControl.ok, false);
  assert.equal(invalidControl.reason, "control_snapshot_invalid");
});

test("step budget is strictly bounded and blocks before producing a trace", () => {
  const tooSmall = simulateExecutorRun(TASKS[0], {
    controlSnapshot: ACTIVE,
    limits: { maxSteps: 2 },
  });
  const tooLarge = simulateExecutorRun(TASKS[0], {
    controlSnapshot: ACTIVE,
    limits: { maxSteps: 6 },
  });
  assert.equal(tooSmall.ok, false);
  assert.equal(tooSmall.reason, "executor_simulation_step_budget_exceeded");
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.reason, "executor_simulation_limits_invalid");
  assert.deepEqual(tooSmall.steps, []);
  assert.deepEqual(tooLarge.steps, []);
});

test("limits and options reject extra fields and non-integer values", () => {
  for (const limits of [
    { maxSteps: 3, unlimited: true },
    { maxSteps: 0 },
    { maxSteps: 1.5 },
    null,
  ]) {
    const result = simulateExecutorRun(TASKS[0], {
      controlSnapshot: ACTIVE,
      limits,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "executor_simulation_limits_invalid");
  }
});

test("simulation trace contains no executable payload or handler material", () => {
  const result = simulateExecutorRun(TASKS[0], { controlSnapshot: ACTIVE });
  for (const forbidden of ["payload", "command", "url", "handler", "request"]) {
    assert.equal(Object.hasOwn(result, forbidden), false);
    for (const step of result.steps) assert.equal(Object.hasOwn(step, forbidden), false);
  }
  assert.deepEqual(result.sideEffects, []);
  assert.equal(result.dispatchCount, 0);
});
