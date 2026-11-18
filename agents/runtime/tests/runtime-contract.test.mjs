import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");

test("runtime uses a recurring Workflow schedule with single-instance concurrency", () => {
  assert.equal(config.workflows.length, 1);
  assert.deepEqual(config.workflows[0].schedules, ["*/15 * * * *"]);
  assert.equal(config.workflows[0].concurrency.limit, 1);
});

test("runtime has no production website bindings or deployment routes", () => {
  assert.equal(config.workers_dev, true);
  assert.equal(config.routes, undefined);
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.ai, undefined);
  assert.match(config.name, /preview$/);
});

test("health endpoint is read-only and reports execution disabled", () => {
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /task_execution_enabled: false/);
  assert.match(source, /production_access: false/);
  assert.doesNotMatch(source, /fetch\(["']https?:/);
});

test("supervisor cycle is explicitly idle and performs no external work", () => {
  assert.match(source, /mode: "safe_idle"/);
  assert.match(source, /tasks_dispatched: 0/);
  assert.match(source, /external_calls: 0/);
  assert.match(source, /task_store_and_authorized_execution_adapters_not_yet_enabled/);
});
