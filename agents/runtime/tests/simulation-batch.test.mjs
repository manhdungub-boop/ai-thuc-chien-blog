import test from "node:test";
import assert from "node:assert/strict";
import { planSimulationBatch, SIMULATION_BATCH_LIMITS } from "../src/simulation-batch.mjs";

const ACTIVE = Object.freeze({ paused: false, emergencyStopped: false });

const TASKS = [
  { type: "content.review", idempotencyKey: "content-review-batch-0001", payload: { articlePath: "articles/agent-runtime-safety.html" } },
  { type: "ai_bank.candidate_review", idempotencyKey: "ai-bank-review-batch-0001", payload: { candidateId: "candidate_123" } },
  { type: "seo.audit", idempotencyKey: "seo-audit-batch-0001", payload: { path: "/guides/agents" } },
];

test("batch planner bounds task count and aggregates deterministic plans", () => {
  const result = planSimulationBatch(TASKS, ACTIVE);
  assert.equal(result.ok, true);
  assert.equal(result.execution, "not_started");
  assert.equal(result.plannedCount, 3);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.plannedStepCount, 9);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result, planSimulationBatch(TASKS, ACTIVE));
  assert.deepEqual(result.sideEffects, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.items));
  assert.ok(result.items.every((item) => Object.isFrozen(item)));
  assert.equal(SIMULATION_BATCH_LIMITS.maxTasks, 10);
  assert.equal(SIMULATION_BATCH_LIMITS.maxSteps, 30);
});

test("batch planner blocks duplicate idempotency keys without planning the duplicate", () => {
  const duplicate = { ...TASKS[0], payload: { articlePath: "articles/other-article.html" } };
  const result = planSimulationBatch([TASKS[0], duplicate], ACTIVE);
  assert.equal(result.ok, true);
  assert.equal(result.plannedCount, 1);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.items[1].blocked, true);
  assert.equal(result.items[1].reason, "duplicate_idempotency_key_in_batch");
  assert.deepEqual(result.items[1].steps, []);
});

test("batch planner fails closed on empty, malformed, or oversized batches", () => {
  for (const input of [null, {}, [], "not-a-batch"]) {
    const result = planSimulationBatch(input, ACTIVE);
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.execution, "not_started");
    assert.deepEqual(result.items, []);
  }

  const oversized = Array.from({ length: SIMULATION_BATCH_LIMITS.maxTasks + 1 }, (_, i) => ({
    ...TASKS[0],
    idempotencyKey: `content-review-batch-${String(i).padStart(4, "0")}`,
  }));
  const result = planSimulationBatch(oversized, ACTIVE);
  assert.equal(result.reason, "batch_task_limit_exceeded");
  assert.equal(result.blockedCount, oversized.length);
  assert.deepEqual(result.items, []);
});

test("batch planner propagates pause and Emergency Stop to every item", () => {
  for (const control of [
    { paused: true, emergencyStopped: false },
    { paused: false, emergencyStopped: true },
  ]) {
    const result = planSimulationBatch(TASKS, control);
    assert.equal(result.plannedCount, 0);
    assert.equal(result.blockedCount, TASKS.length);
    assert.equal(result.blocked, true);
    assert.ok(result.items.every((item) => item.blocked && item.steps.length === 0));
    assert.deepEqual(result.sideEffects, []);
  }
});

test("batch planner never returns executable payloads or external side-effect instructions", () => {
  const result = planSimulationBatch(TASKS, ACTIVE);
  for (const item of result.items) {
    assert.equal(Object.hasOwn(item, "payload"), false);
    assert.equal(Object.hasOwn(item, "url"), false);
    assert.deepEqual(item.sideEffects, []);
  }
});
