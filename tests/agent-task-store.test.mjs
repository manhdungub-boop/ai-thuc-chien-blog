import test from "node:test";
import assert from "node:assert/strict";
import { emptyQueue, enqueueTask, transitionTask, validateQueue } from "../scripts/agent-task-store.mjs";

const task = { task_id:"research-001", state:"RECEIVED", evidence:[] };

test("creates a valid empty queue", () => assert.deepEqual(validateQueue(emptyQueue()), {ok:true,errors:[]}));
test("enqueues a stable task ID exactly once", () => {
  const first = enqueueTask(emptyQueue(), task);
  const second = enqueueTask(first.queue, task);
  assert.equal(first.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.queue.tasks.length, 1);
});
test("rejects duplicate IDs already present in a malformed queue", () => {
  const result = validateQueue({schema_version:1,tasks:[task,task]});
  assert.ok(result.errors.includes("duplicate_task_id"));
});
test("allows only declared next-state transitions", () => {
  assert.equal(transitionTask(task,"TRIAGED").ok, true);
  assert.equal(transitionTask(task,"DONE").error, "transition_not_allowed");
});
test("requires evidence before DONE", () => {
  const inReview = {...task,state:"REVIEW"};
  assert.equal(transitionTask(inReview,"DONE").error, "done_requires_evidence");
  const done = transitionTask(inReview,"DONE",["test://evidence"]);
  assert.equal(done.ok, true);
  assert.equal(done.task.evidence.length, 1);
});
test("blocks invalid states and terminal-state transitions", () => {
  assert.equal(transitionTask({...task,state:"DONE"},"RECEIVED").error, "transition_not_allowed");
  assert.equal(transitionTask({...task,state:"UNKNOWN"},"TRIAGED").error, "invalid_state");
});
test("does not accept completed tasks without evidence in persisted queue", () => {
  const result = validateQueue({schema_version:1,tasks:[{...task,state:"DONE"}]});
  assert.ok(result.errors.includes("done_requires_evidence"));
});
