import test from "node:test";
import assert from "node:assert/strict";
import { planTaskSimulation } from "../src/simulation-planner.mjs";

const ACTIVE = Object.freeze({ paused: false, emergencyStopped: false });

const TASKS = [
  {
    type: "content.review",
    idempotencyKey: "content-review-test-0001",
    payload: { articlePath: "articles/agent-runtime-safety.html" },
  },
  {
    type: "ai_bank.candidate_review",
    idempotencyKey: "ai-bank-review-test-0001",
    payload: { candidateId: "candidate_123" },
  },
  {
    type: "seo.audit",
    idempotencyKey: "seo-audit-test-0001",
    payload: { path: "/guides/agents" },
  },
];

test("simulation planner creates deterministic plans for every allowlisted task type", () => {
  for (const task of TASKS) {
    const first = planTaskSimulation(task, ACTIVE);
    const second = planTaskSimulation(task, ACTIVE);
    assert.equal(first.ok, true);
    assert.equal(first.mode, "simulation");
    assert.equal(first.execution, "not_started");
    assert.equal(first.blocked, false);
    assert.equal(first.taskType, task.type);
    assert.ok(first.steps.length > 0);
    assert.deepEqual(first, second);
    assert.deepEqual(first.sideEffects, []);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.steps));
    assert.ok(Object.isFrozen(first.sideEffects));
  }
});

test("simulation planner never starts work when paused or emergency-stopped", () => {
  for (const task of TASKS) {
    const paused = planTaskSimulation(task, { paused: true, emergencyStopped: false });
    assert.equal(paused.blocked, true);
    assert.equal(paused.reason, "runtime_paused");
    assert.equal(paused.execution, "not_started");
    assert.deepEqual(paused.steps, []);

    const stopped = planTaskSimulation(task, { paused: false, emergencyStopped: true });
    assert.equal(stopped.blocked, true);
    assert.equal(stopped.reason, "emergency_stop_active");
    assert.equal(stopped.execution, "not_started");
    assert.deepEqual(stopped.steps, []);
  }
});

test("simulation planner fails closed for malformed task and control snapshots", () => {
  const invalidTask = planTaskSimulation({
    type: "arbitrary.shell",
    idempotencyKey: "invalid-task-key-0001",
    payload: { command: "touch /tmp/pwned" },
  }, ACTIVE);
  assert.equal(invalidTask.ok, false);
  assert.equal(invalidTask.blocked, true);
  assert.match(invalidTask.reason, /^task_invalid:/);
  assert.deepEqual(invalidTask.sideEffects, []);

  for (const invalidControl of [
    undefined,
    null,
    {},
    { paused: false },
    { paused: false, emergencyStopped: false, extra: true },
    { paused: "false", emergencyStopped: false },
  ]) {
    const result = planTaskSimulation(TASKS[0], invalidControl);
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "control_snapshot_invalid");
    assert.equal(result.execution, "not_started");
    assert.deepEqual(result.steps, []);
  }
});

test("simulation planner exposes descriptions only and never returns executable payloads", () => {
  const result = planTaskSimulation(TASKS[0], ACTIVE);
  assert.equal(Object.hasOwn(result, "command"), false);
  assert.equal(Object.hasOwn(result, "url"), false);
  assert.equal(Object.hasOwn(result, "request"), false);
  assert.equal(Object.hasOwn(result, "payload"), false);
  assert.deepEqual(result.sideEffects, []);
});
