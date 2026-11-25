import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Pause E2E Worker is isolated, disabled by default, and has no Production bindings", async () => {
  const config = JSON.parse(await read("../wrangler.pause-e2e.jsonc"));
  const preview = JSON.parse(await read("../wrangler.preview.jsonc"));
  const production = JSON.parse(await read("../wrangler.jsonc"));

  assert.equal(config.name, "ai-thuc-chien-agent-runtime-pause-e2e");
  assert.notEqual(config.name, preview.name);
  assert.notEqual(config.name, production.name);
  assert.equal(config.main, "./tests/pause-e2e-worker.mjs");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.durable_objects.bindings, [
    { name: "AGENT_STATE_STORE", class_name: "PauseE2EAgentStateStore" },
    { name: "AGENT_DRAFT_STORE", class_name: "AgentDraftStore" },
  ]);
  assert.deepEqual(config.migrations, [
    { tag: "pause-e2e-v1", new_sqlite_classes: ["PauseE2EAgentStateStore", "AgentDraftStore"] },
  ]);
  assert.equal(config.vars.AGENT_ENABLED, "false");
  assert.equal(config.vars.AGENT_PAUSED, "true");
  assert.equal(config.vars.AGENT_SCHEDULER_ENABLED, "false");
  assert.equal(config.vars.AGENT_RECOVERY_ALARM_ENABLED, "false");
  assert.equal(config.vars.AGENT_OIDC_ENABLED, "true");
  assert.equal(config.vars.AGENT_OIDC_RUN_ENABLED, "false");
  assert.equal(config.vars.AGENT_PAUSE_E2E_GATE_ENABLED, "true");
  assert.equal(config.vars.AGENT_RATE_LIMIT_REQUIRED, "true");
  for (const forbidden of ["routes", "d1_databases", "queues", "services", "triggers"]) {
    assert.equal(forbidden in config, false, forbidden + " must not be bound to the test Worker");
  }
  assert.equal(Object.keys(config.vars).some((key) => /TOKEN|SECRET|PRIVATE_KEY/i.test(key)), false);
  assert.equal("AGENT_PAUSE_E2E_GATE_ENABLED" in preview.vars, false);
  assert.equal("AGENT_PAUSE_E2E_GATE_ENABLED" in production.vars, false);
});

test("Pause E2E gate intercepts only the allowlisted public article fetch and preserves OIDC verification", async () => {
  const source = await read("./pause-e2e-worker.mjs");
  assert.match(source, /raw\.githubusercontent\.com\/manhdungub-boop\/ai-thuc-chien-blog\/main\/articles\/ai-agent-thuc-hanh-tu-thiet-ke-den-kiem-soat\.html/);
  assert.match(source, /runtimeEnv\?\.AGENT_PAUSE_E2E_GATE_ENABLED === "true"/);
  assert.match(source, /delay === 8_000/);
  assert.match(source, /adjustedDelay.*45_000/s);
  assert.match(source, /GATE_TIMEOUT_MS = 120_000/);
  assert.match(source, /signal\.addEventListener\("abort"/);
  assert.match(source, /worker\.fetch\(request, env, ctx\)/);
  assert.match(source, /authorizeGitHubActionsOperator/);
  assert.match(source, /eventName: "pull_request"/);
  assert.match(source, /setRuntimePaused\(true, version \+ 1\)/);
  assert.match(source, /task\.cancelled/);
});

test("Run and Pause workflows use distinct owner-gated OIDC identities and always clean up", async () => {
  const runWorkflow = await read("../../../.github/workflows/agent-runtime-adapter-pause-e2e.yml");
  const pauseWorkflow = await read("../../../.github/workflows/agent-runtime-adapter-pause-operator.yml");
  for (const workflow of [runWorkflow, pauseWorkflow]) {
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /types: \[synchronize\]/);
    assert.match(workflow, /github\.event\.action == 'synchronize'/);
    assert.match(workflow, /security\/agent-runtime-adapter-pause-e2e-20261125/);
    assert.match(workflow, /github\.actor_id == '342528485'/);
    assert.match(workflow, /environment: agent-runtime-preview/);
    assert.match(workflow, /id-token: write/);
    assert.doesNotMatch(workflow, /pull_request_target:|schedule:|push:|actions: write|contents: write/i);
  }
  assert.match(runWorkflow, /actions: read/);
  assert.match(runWorkflow, /if: always\(\)/);
  assert.match(runWorkflow, /PAUSE_E2E_DEPLOY_ATTEMPTED/);
  assert.match(runWorkflow, /workers\/scripts/);
  assert.match(runWorkflow, /previews_enabled/);
  assert.match(runWorkflow, /AGENT_STATE_STORE_TOKEN/);
  assert.match(runWorkflow, /PAUSE_E2E_IN_FLIGHT_READY/);
  assert.match(pauseWorkflow, /__e2e\/pause/);
  assert.match(pauseWorkflow, /PAUSE_E2E_IN_FLIGHT_READY/);
});
