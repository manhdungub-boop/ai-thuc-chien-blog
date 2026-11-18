import test from "node:test";
import assert from "node:assert/strict";
import worker, { AgentSupervisorWorkflow } from "../src/index.mjs";

test("health endpoint exposes safe preview status", async () => {
  const response = await worker.fetch(new Request("https://runtime.example/health"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.task_execution_enabled, false);
  assert.equal(body.production_access, false);
});

test("runtime rejects non-GET requests", async () => {
  const response = await worker.fetch(new Request("https://runtime.example/health", { method: "POST" }), {});
  assert.equal(response.status, 405);
});

test("runtime does not expose arbitrary task execution routes", async () => {
  const response = await worker.fetch(new Request("https://runtime.example/tasks"), {});
  assert.equal(response.status, 404);
});

test("supervisor records safe idle cycle with no external work", async () => {
  const calls = [];
  const workflow = Object.create(AgentSupervisorWorkflow.prototype);
  workflow.env = {};
  const result = await workflow.run({ instanceId: "cycle-test", timestamp: Date.now() }, {
    do: async (name, fn) => { calls.push(name); return fn(); }
  });
  assert.deepEqual(calls, ["record-supervisor-cycle"]);
  assert.equal(result.status, "healthy_idle");
  assert.equal(result.cycle.tasks_dispatched, 0);
  assert.equal(result.cycle.external_calls, 0);
});
