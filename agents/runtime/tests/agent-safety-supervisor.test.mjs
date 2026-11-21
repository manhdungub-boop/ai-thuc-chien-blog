import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAgentSafetySnapshot,
  AGENT_SUPERVISOR_POLICY,
} from "../src/agent-safety-supervisor.mjs";

const safeSnapshot = () => ({
  agentEnabled: false,
  agentPaused: true,
  schedulerConfigured: false,
  executorConfigured: false,
  productionBindingsPresent: false,
  cloudflareBudgetVerified: true,
});

test("supervisor reports safe idle only when every safety condition is evidenced", () => {
  const result = evaluateAgentSafetySnapshot(safeSnapshot());
  assert.equal(result.ok, true);
  assert.equal(result.status, "safe_idle");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sideEffects, []);
  assert.equal(AGENT_SUPERVISOR_POLICY.pollsContinuously, false);
  assert.equal(AGENT_SUPERVISOR_POLICY.changesRuntimeState, false);
});

test("supervisor fails closed when any required evidence is missing", () => {
  const snapshot = safeSnapshot();
  delete snapshot.cloudflareBudgetVerified;
  const result = evaluateAgentSafetySnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.status, "evidence_incomplete");
  assert.ok(result.issues.some(issue => issue.code === "evidence_missing:cloudflareBudgetVerified"));
  assert.ok(result.actions.includes("do_not_enable_or_deploy"));
});

test("supervisor requires stop when runtime is enabled or unpaused", () => {
  const snapshot = safeSnapshot();
  snapshot.agentEnabled = true;
  snapshot.agentPaused = false;
  const result = evaluateAgentSafetySnapshot(snapshot);
  assert.equal(result.status, "stop_required");
  assert.ok(result.issues.some(issue => issue.code === "agent_enabled_without_release_gate"));
  assert.ok(result.issues.some(issue => issue.code === "agent_not_paused"));
});

test("supervisor flags scheduler, executor and production bindings", () => {
  const snapshot = safeSnapshot();
  snapshot.schedulerConfigured = true;
  snapshot.executorConfigured = true;
  snapshot.productionBindingsPresent = true;
  const result = evaluateAgentSafetySnapshot(snapshot);
  assert.equal(result.status, "stop_required");
  assert.equal(result.issues.length, 3);
});

test("unverified Cloudflare budget is a warning, never permission to deploy", () => {
  const snapshot = safeSnapshot();
  snapshot.cloudflareBudgetVerified = false;
  const result = evaluateAgentSafetySnapshot(snapshot);
  assert.equal(result.status, "safe_but_unverified");
  assert.equal(result.issues[0].code, "cloudflare_budget_unverified");
  assert.ok(result.actions.includes("do_not_enable_or_deploy"));
});

test("invalid input is rejected with no side effects", () => {
  const result = evaluateAgentSafetySnapshot(null);
  assert.equal(result.ok, false);
  assert.equal(result.status, "evidence_incomplete");
  assert.deepEqual(result.sideEffects, []);
});
