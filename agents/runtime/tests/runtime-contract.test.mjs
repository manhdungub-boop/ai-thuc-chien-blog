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
  assert.match(source, /task_execution_enabled: true/);
  assert.match(source, /task_enqueue_endpoint_enabled: false/);
  assert.match(source, /production_access: false/);
  assert.doesNotMatch(source, /fetch\(["']https?:/);
});

test("supervisor executes bounded health and daily read-only discovery tasks", () => {
  assert.match(source, /"runtime_health_check"/);
  assert.match(source, /store\.claim\(\[taskType\], taskId\)/);
  assert.match(source, /await store\.complete\(taskId, claimed\.lease_token, result\)/);
  assert.match(source, /discoverAiBankReleaseSignals/);
  assert.match(source, /ai-bank-scan-/);
  assert.match(source, /ai_bank_discovery/);
  assert.match(source, /catalog_modified: false/);
  assert.match(source, /tasks_dispatched: 2/);
  assert.match(source, /external_calls: 0/);
  assert.match(source, /production_access: false/);
});

test("task store enforces an allowlist, bounded payloads, and idempotent IDs", () => {
  assert.match(store, /TASK_TYPES\.has\(task\.task_type\)/);
  assert.match(store, /function validatePayload\(type, payload\)/);
  assert.match(store, /ai_bank_discovery: \["query"\]/);
  assert.match(store, /content_research: \["topic", "language"\]/);
  assert.match(store, /content_draft: \["topic", "research_task_id"\]/);
  assert.match(store, /quality_review: \["artifact_id", "artifact_type"\]/);
  assert.match(store, /runtime_health_check: \[\]/);
  assert.match(store, /MAX_PAYLOAD_BYTES = 8192/);
  assert.match(store, /result_json TEXT/);
  assert.match(store, /result_too_large/);
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
  assert.match(store, /crypto\.randomUUID\(\)/);
  assert.match(store, /lease_token = \?/);
  assert.match(store, /row\.lease_token !== leaseToken/);
});

test("completed and retried tasks release lease credentials and recheck expiry", () => {
  assert.match(store, /status = 'completed', lease_until = NULL, lease_token = NULL/);
  assert.match(store, /lease_until > \? AND lease_token = \?/);
  assert.match(store, /RETURNING id/);
  assert.match(store, /updated\.length === 1/);
});

test("idempotency keys cannot be reused for a different task payload", () => {
  assert.match(store, /existing\.task_type === task\.task_type/);
  assert.match(store, /existing\.payload_json === payloadJson/);
  assert.match(store, /idempotency_key_conflict/);
});
