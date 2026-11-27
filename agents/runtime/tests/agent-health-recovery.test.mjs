import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAgentHealthSnapshot } from "../src/agent-health-monitor.mjs";
import { planAgentRecovery } from "../src/agent-recovery-planner.mjs";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const snapshot = (overrides = {}) => ({
  observedAt: "2026-11-20T11:59:00.000Z",
  components: { stateStore: "healthy", workerBridge: "healthy", usageEvidence: "healthy" },
  heartbeatAgeMs: 30_000,
  queuedTasks: 2,
  runningTasks: 1,
  expiredLeases: 0,
  ...overrides,
});

test("health monitor reports healthy for fresh, bounded and complete evidence", () => {
  const result = evaluateAgentHealthSnapshot(snapshot(), { nowMs: NOW });
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sideEffects, []);
});

test("health monitor degrades on component warning or delayed heartbeat", () => {
  const result = evaluateAgentHealthSnapshot(snapshot({
    components: { stateStore: "healthy", workerBridge: "degraded", usageEvidence: "healthy" },
    heartbeatAgeMs: 6 * 60 * 1000,
  }), { nowMs: NOW });
  assert.equal(result.status, "degraded");
  assert.ok(result.issues.some(x => x.code === "component_degraded:workerBridge"));
  assert.ok(result.issues.some(x => x.code === "heartbeat_delayed"));
});

test("health monitor marks unavailable component and expired leases critical", () => {
  const result = evaluateAgentHealthSnapshot(snapshot({
    components: { stateStore: "unavailable", workerBridge: "healthy", usageEvidence: "healthy" },
    expiredLeases: 1,
  }), { nowMs: NOW });
  assert.equal(result.status, "critical");
  assert.equal(result.recoveryRequired, true);
});

test("health monitor fails closed for stale, future, malformed and excessive observations", () => {
  assert.equal(evaluateAgentHealthSnapshot(snapshot({ observedAt: "2026-11-20T11:00:00.000Z" }), { nowMs: NOW }).status, "evidence_incomplete");
  assert.equal(evaluateAgentHealthSnapshot(snapshot({ observedAt: "2026-11-20T13:00:00.000Z" }), { nowMs: NOW }).status, "evidence_incomplete");
  assert.equal(evaluateAgentHealthSnapshot(snapshot({ runningTasks: 6 }), { nowMs: NOW }).status, "evidence_incomplete");
  assert.equal(evaluateAgentHealthSnapshot(snapshot({ components: {} }), { nowMs: NOW }).status, "evidence_incomplete");
});

test("recovery planner recommends manual pause and reconciliation but never performs actions", () => {
  const health = evaluateAgentHealthSnapshot(snapshot({ expiredLeases: 1 }), { nowMs: NOW });
  const plan = planAgentRecovery(health);
  assert.equal(plan.status, "manual_recovery_required");
  assert.ok(plan.steps.includes("manually_pause_agent_if_running"));
  assert.ok(plan.steps.includes("reconcile_task_and_audit_records"));
  assert.equal(plan.mayAutoResume, false);
  assert.equal(plan.performsPause, false);
  assert.equal(plan.performsLeaseRecovery, false);
  assert.deepEqual(plan.sideEffects, []);
});

test("healthy recovery plan keeps runtime disabled and invalid evidence requires operator review", () => {
  const healthy = planAgentRecovery(evaluateAgentHealthSnapshot(snapshot(), { nowMs: NOW }));
  assert.equal(healthy.status, "healthy_no_recovery_action");
  assert.ok(healthy.steps.includes("keep_agent_disabled_until_separate_release_approval"));
  const invalid = planAgentRecovery({ status: "evidence_incomplete", issues: [] });
  assert.equal(invalid.status, "operator_review_required");
  assert.equal(invalid.mayAutoResume, false);
});
