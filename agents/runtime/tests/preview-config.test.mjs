import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AgentStateStore } from "../src/worker.mjs";

const configPath = fileURLToPath(new URL("../wrangler.preview.jsonc", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8"));

test("dedicated Agent Runtime Preview config binds its isolated State Store and rate limiter and remains disabled", () => {
  assert.equal(config.name, "ai-thuc-chien-agent-runtime-preview");
  assert.equal(config.main, "./src/worker.mjs");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, true);
  assert.deepEqual(config.vars, {
    AGENT_ENABLED: "false",
    AGENT_SCHEDULER_ENABLED: "false",
    AGENT_PAUSED: "true",
    AGENT_RECOVERY_ALARM_ENABLED: "false",
    AGENT_OIDC_ENABLED: "false",
    AGENT_RATE_LIMIT_REQUIRED: "true",
    AGENT_OIDC_AUDIENCE: "ai-thuc-chien-agent-runtime-preview",
    AGENT_OIDC_REPOSITORY: "manhdungub-boop/ai-thuc-chien-blog",
    AGENT_OIDC_REPOSITORY_OWNER: "manhdungub-boop",
    AGENT_OIDC_REPOSITORY_ID: "1423636651",
    AGENT_OIDC_REPOSITORY_OWNER_ID: "342528485",
    AGENT_OIDC_REF: "refs/heads/main",
    AGENT_OIDC_WORKFLOW_REF: "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/agent-runtime-operator.yml@refs/heads/main",
    AGENT_OIDC_ACTOR_ID: "342528485",
  });
  assert.equal(Object.hasOwn(config, "triggers"), false, "recurring triggers stay absent until Free-plan headroom is independently verified and approved");
  assert.deepEqual(config.ratelimits, [{
    name: "AGENT_INGRESS_RATE_LIMITER",
    namespace_id: "20261121",
    simple: { limit: 60, period: 60 },
  }]);
  assert.deepEqual(config.durable_objects, {
    bindings: [{ name: "AGENT_STATE_STORE", class_name: "AgentStateStore" }],
  });
  assert.deepEqual(config.migrations, [{
    tag: "v1",
    new_sqlite_classes: ["AgentStateStore"],
  }]);
  for (const forbidden of [
    "account_id", "routes", "route", "custom_domains", "d1_databases",
    "kv_namespaces", "r2_buckets", "services", "queues",
    "vars_secrets", "secrets",
  ]) {
    assert.equal(Object.hasOwn(config, forbidden), false, "unexpected config key: " + forbidden);
  }
});

test("Preview config never enables autonomous execution by default", () => {
  assert.notEqual(config.vars.AGENT_ENABLED, "true");
  assert.notEqual(config.vars.AGENT_PAUSED, "false");
  assert.notEqual(config.vars.AGENT_RECOVERY_ALARM_ENABLED, "true");
  assert.notEqual(config.vars.AGENT_SCHEDULER_ENABLED, "true");
});

test("Worker entrypoint exports the Durable Object class named by the Preview config", () => {
  assert.equal(typeof AgentStateStore, "function");
});

test("GitHub OIDC operator remains disabled while pinning only the observed GitHub actor", () => {
  assert.equal(config.vars.AGENT_OIDC_ENABLED, "false");
  assert.equal(config.vars.AGENT_OIDC_ACTOR_ID, "342528485");
});
