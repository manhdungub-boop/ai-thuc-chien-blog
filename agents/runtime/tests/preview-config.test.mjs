import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const configPath = fileURLToPath(new URL("../wrangler.preview.jsonc", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8"));

test("dedicated Agent Runtime Preview config binds only its SQLite State Store and remains disabled", () => {
  assert.equal(config.name, "ai-thuc-chien-agent-runtime-preview");
  assert.equal(config.main, "./src/worker.mjs");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, true);
  assert.deepEqual(config.vars, { AGENT_ENABLED: "false", AGENT_PAUSED: "true" });
  assert.deepEqual(config.durable_objects, {
    bindings: [{ name: "AGENT_STATE_STORE", class_name: "AgentStateStore" }],
  });
  assert.deepEqual(config.migrations, [{
    tag: "v1",
    new_sqlite_classes: ["AgentStateStore"],
  }]);
  for (const forbidden of [
    "account_id", "routes", "route", "custom_domains", "d1_databases",
    "kv_namespaces", "r2_buckets", "services", "queues", "triggers",
    "vars_secrets", "secrets",
  ]) {
    assert.equal(Object.hasOwn(config, forbidden), false, "unexpected config key: " + forbidden);
  }
});

test("Preview config never enables autonomous execution by default", () => {
  assert.notEqual(config.vars.AGENT_ENABLED, "true");
  assert.notEqual(config.vars.AGENT_PAUSED, "false");
});
