import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
const store = await readFile(new URL("../src/task-store.mjs", import.meta.url), "utf8");

test("runtime uses a recurring Workflow schedule with single-instance concurrency", () => {
  assert.equal(config.workflows.length, 1);
  assert.deepEqual(config.workflows[0].schedules, ["*/15 * * * *"]);
  assert.equal(config.workflows[0].concurrency.limit, 1);
});

test("runtime has isolated SQLite storage and no website Production bindings", () => {
  assert.equal(config.workers_dev, true);
  assert.equal(config.routes, undefined);
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.ai, undefined);
  assert.match(config.name, /preview$/);
  assert.deepEqual(config.durable_objects.bindings, [
    { name: "AGENT_TASK_STORE", class_name: "AgentTaskStore" }
  ]);
  assert.deepEqual(config.migrations[0].new_sqlite_classes, ["AgentTaskStore"]);
});

test("health endpoint is read-only and does not expose task enqueue", () => {
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /task_execution_enabled: false/);
  assert.match(source, /task_enqueue_endpoint_enabled: false/);
  assert.match(source, /production_access: false/);
  assert.doesNotMatch(source, /fetch\(["']https?:/);
});

test("supervisor cycle remains idle and performs no external work", () => {
  assert.match(source, /mode: "safe_idle"/);
  assert.match(source, /tasks_dispatched: 0/);
  assert.match(source, /external_calls: 0/);
  assert.match(source, /this\.env\.AGENT_TASK_STORE\.getByName\("primary"\)/);
  assert.match(source, /await store\.stats\(\)/);
});

test("task store enforces an allowlist, bounded payloads, and idempotent IDs", () => {
  assert.match(store, /TASK_TYPES\.has\(task\.task_type\)/);
  assert.match(store, /MAX_PAYLOAD_BYTES = 8192/);
  assert.match(store, /INSERT OR IGNORE INTO tasks/);
  assert.match(store, /inserted\.rowsWritten === 0/);
  assert.match(store, /MAX_ACTIVE_TASKS = 500/);
  assert.match(store, /queue_capacity_reached/);
  assert.match(store, /id TEXT PRIMARY KEY/);
});

test("task store has bounded leases, retry ceiling, and dead-letter state", () => {
  assert.match(store, /MAX_ATTEMPTS = 5/);
  assert.match(store, /LEASE_MS = 5 \* 60 \* 1000/);
  assert.match(store, /status IN \('pending','leased','completed','dead'\)/);
  assert.match(store, /attempts >= \?/);
  assert.match(store, /lease_until > \?/);
  assert.match(store, /row\.lease_until <= now/);
});
