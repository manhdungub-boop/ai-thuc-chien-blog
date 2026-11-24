import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AgentStateStore, AgentReviewerAuthStore, AgentDraftStore, AgentAIBankCandidateStore } from "../src/worker.mjs";
import { TestAgentStateStore } from "./state-store-test-worker.mjs";

const configPath = fileURLToPath(new URL("../wrangler.preview.jsonc", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const faultTestConfigPath = fileURLToPath(new URL("../wrangler.fault-test.jsonc", import.meta.url));
const faultTestConfig = JSON.parse(readFileSync(faultTestConfigPath, "utf8"));
const faultTestWorkflowPath = fileURLToPath(new URL("../../../.github/workflows/agent-runtime-cloudflare-do-fault-test.yml", import.meta.url));
const faultTestWorkflowSource = readFileSync(faultTestWorkflowPath, "utf8");

test("dedicated Agent Runtime Preview config binds its isolated State Store and rate limiter and remains disabled", () => {
  assert.equal(config.name, "ai-thuc-chien-agent-runtime-preview");
  assert.equal(config.main, "./src/worker.mjs");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.vars, {
    AGENT_ENABLED: "false",
    AGENT_SCHEDULER_ENABLED: "false",
    AGENT_PAUSED: "true",
    AGENT_RECOVERY_ALARM_ENABLED: "false",
    AGENT_OIDC_ENABLED: "true",
    AGENT_REVIEWER_AUTH_ENABLED: "false",
    AGENT_CONSOLE_ACCESS_PROTECTED: "true",
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
    bindings: [
      { name: "AGENT_STATE_STORE", class_name: "AgentStateStore" },
      { name: "AGENT_REVIEWER_AUTH_STORE", class_name: "AgentReviewerAuthStore" },
      { name: "AGENT_DRAFT_STORE", class_name: "AgentDraftStore" },
      { name: "AGENT_AI_BANK_CANDIDATE_STORE", class_name: "AgentAIBankCandidateStore" },
    ],
  });
  assert.deepEqual(config.migrations, [
    { tag: "v1", new_sqlite_classes: ["AgentStateStore"] },
    { tag: "v2", new_sqlite_classes: ["AgentReviewerAuthStore", "AgentDraftStore"] },
    { tag: "v3-ai-bank-candidate-store", new_sqlite_classes: ["AgentAIBankCandidateStore"] },
  ]);
  for (const forbidden of [
    "account_id", "routes", "route", "custom_domains", "d1_databases",
    "kv_namespaces", "r2_buckets", "services", "queues",
    "vars_secrets", "secrets",
  ]) {
    assert.equal(Object.hasOwn(config, forbidden), false, "unexpected config key: " + forbidden);
  }
});


test("fault-test cleanup removes the one-run secret and disables public routes without deleting the Worker", () => {
  assert.ok(faultTestWorkflowSource.includes("$api/secrets/AGENT_FAULT_TEST_TOKEN"));
  assert.ok(faultTestWorkflowSource.includes("--request POST"));
  assert.ok(faultTestWorkflowSource.includes('{"enabled":false,"previews_enabled":false}'));
  assert.ok(faultTestWorkflowSource.includes("--request DELETE"));
  assert.ok(faultTestWorkflowSource.includes("$api/subdomain"));
  assert.equal(faultTestWorkflowSource.includes("wrangler@4.166.0 delete"), false);
});

test("fault-test harness remains disabled, paused, and migration-compatible", () => {
  assert.equal(faultTestConfig.vars.AGENT_ENABLED, "false");
  assert.equal(faultTestConfig.vars.AGENT_PAUSED, "true");
  assert.equal(faultTestConfig.vars.AGENT_SCHEDULER_ENABLED, "false");
  assert.equal(faultTestConfig.vars.AGENT_RECOVERY_ALARM_ENABLED, "false");
  assert.equal(faultTestConfig.migrations.at(-1)?.tag, "fault-test-v1");
  assert.equal(faultTestConfig.durable_objects.bindings.find(binding => binding.name === "AGENT_STATE_STORE")?.class_name, "TestAgentStateStore");
});
const faultTestWorkerSource = readFileSync(fileURLToPath(new URL("./state-store-test-worker.mjs", import.meta.url)), "utf8");

test("fault-test DO enables state transitions only inside the token-gated isolated class", () => {
  assert.match(faultTestWorkerSource, /const faultSuiteMode = \{ active: false \}/);
  assert.match(faultTestWorkerSource, /faultSuiteMode\.active && property === "AGENT_ENABLED"/);
  assert.match(faultTestWorkerSource, /faultSuiteMode\.active && property === "AGENT_PAUSED"/);
  assert.match(faultTestWorkerSource, /AGENT_STATE_STORE_TOKEN:\s*env\.AGENT_FAULT_TEST_TOKEN/);
  const faultRouteIndex = faultTestWorkerSource.indexOf('if (url.pathname === "/__test/fault-suite")');
  const enableIndex = faultTestWorkerSource.indexOf("this.faultSuiteMode.active = true");
  const resetIndex = faultTestWorkerSource.indexOf("this.faultSuiteMode.active = false");
  assert.ok(faultRouteIndex >= 0 && enableIndex > faultRouteIndex && resetIndex > enableIndex);
  assert.equal(faultTestConfig.vars.AGENT_ENABLED, "false");
  assert.equal(faultTestConfig.vars.AGENT_PAUSED, "true");
});

test("fault-test Worker exports its test-only Durable Object class outside the application entrypoint", () => {
  assert.equal(typeof TestAgentStateStore, "function");
});

test("Preview config never enables autonomous execution by default", () => {
  assert.notEqual(config.vars.AGENT_ENABLED, "true");
  assert.notEqual(config.vars.AGENT_PAUSED, "false");
  assert.notEqual(config.vars.AGENT_RECOVERY_ALARM_ENABLED, "true");
  assert.notEqual(config.vars.AGENT_SCHEDULER_ENABLED, "true");
  assert.notEqual(config.vars.AGENT_REVIEWER_AUTH_ENABLED, "true");
});

test("Worker entrypoint exports the Durable Object class named by the Preview config", () => {
  assert.equal(typeof AgentStateStore, "function");
  assert.equal(typeof AgentReviewerAuthStore, "function");
  assert.equal(typeof AgentDraftStore, "function");
  assert.equal(typeof AgentAIBankCandidateStore, "function");
});

test("GitHub OIDC is enabled only for the pause-only Preview operator", () => {
  assert.equal(config.vars.AGENT_OIDC_ENABLED, "true");
  assert.equal(config.vars.AGENT_ENABLED, "false");
  assert.equal(config.vars.AGENT_PAUSED, "true");
  assert.equal(config.vars.AGENT_SCHEDULER_ENABLED, "false");
  assert.equal(config.vars.AGENT_RECOVERY_ALARM_ENABLED, "false");
  assert.equal(config.vars.AGENT_REVIEWER_AUTH_ENABLED, "false");
  assert.equal(config.vars.AGENT_OIDC_ACTOR_ID, "342528485");
});


test("GitHub OIDC Pause workflow pins the bearer-token destination to the exact Preview origin", () => {
  const workflowPath = fileURLToPath(new URL("../../../.github/workflows/agent-runtime-operator.yml", import.meta.url));
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /target\.origin !== 'https:\/\/ai-thuc-chien-agent-runtime-preview\.manhdungub\.workers\.dev'/);
  assert.match(workflow, /target\.pathname !== '\/'/);
  assert.doesNotMatch(workflow, /target\.hostname/);
});
