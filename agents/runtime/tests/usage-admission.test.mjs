import test from "node:test";
import assert from "node:assert/strict";
import { validateUsageEvidence } from "../src/usage-evidence-collector.mjs";
import { evaluateRuntimeAdmission } from "../src/runtime-admission-controller.mjs";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const usage = (overrides = {}) => ({
  source: "cloudflare_dashboard_export",
  sourceRef: "billing-export-2026-11-20",
  accountRef: "account-alias-redacted",
  plan: "free",
  observedAt: "2026-11-20T11:30:00.000Z",
  resources: [
    { metric: "workers_requests", used: 100, limit: 1000 },
    { metric: "workers_cpu_ms", used: 20, limit: 100 },
  ],
  ...overrides,
});
const safetySnapshot = {
  agentEnabled: false,
  agentPaused: true,
  schedulerConfigured: false,
  executorConfigured: false,
  productionBindingsPresent: false,
  cloudflareBudgetVerified: true,
};
const budgetLedger = {
  verified: true, period: "2026-11-20",
  dailyLimitUnits: 10, consumedUnits: 1, reservedUnits: 1,
};
const requests = [{ id: "task-1", type: "content.review", units: 2 }];

test("usage collector validates fresh, complete resource snapshots without claiming attestation", () => {
  const result = validateUsageEvidence(usage(), { nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.status, "valid_free_plan_claim");
  assert.equal(result.resources[0].remaining, 900);
  assert.equal(result.executionAuthority, false);
  assert.ok(result.limitations.includes("caller_supplied_evidence_not_independently_authenticated"));
});

test("usage collector rejects stale, future, unknown-source and inconsistent resource evidence", () => {
  assert.equal(validateUsageEvidence(usage({ observedAt: "2026-11-18T00:00:00.000Z" }), { nowMs: NOW }).reason, "evidence_stale_or_future");
  assert.equal(validateUsageEvidence(usage({ observedAt: "2026-11-20T13:00:00.000Z" }), { nowMs: NOW }).reason, "evidence_stale_or_future");
  assert.equal(validateUsageEvidence(usage({ source: "user_assertion" }), { nowMs: NOW }).reason, "evidence_metadata_invalid");
  assert.equal(validateUsageEvidence(usage({ resources: [{ metric: "workers_requests", used: 11, limit: 10 }] }), { nowMs: NOW }).reason, "evidence_resource_invalid");
  assert.equal(validateUsageEvidence(usage({ resources: [{ metric: "unknown", used: 1, limit: 10 }] }), { nowMs: NOW }).reason, "evidence_resource_invalid");
});

test("admission is blocked without safety, usage, and budget evidence", () => {
  const result = evaluateRuntimeAdmission({ requests });
  assert.equal(result.status, "blocked");
  assert.equal(result.executionStarted, false);
  assert.equal(result.reservationPersisted, false);
  assert.ok(result.blockers.includes("safety_gate_not_clear"));
  assert.ok(result.blockers.includes("free_plan_usage_evidence_not_validated"));
  assert.ok(result.blockers.includes("internal_capacity_budget_blocked"));
});

test("admission remains blocked for paid or unconfirmed plan evidence", () => {
  const paid = validateUsageEvidence(usage({ plan: "paid" }), { nowMs: NOW });
  const unknown = validateUsageEvidence(usage({ plan: "unknown" }), { nowMs: NOW });
  for (const evidence of [paid, unknown]) {
    const result = evaluateRuntimeAdmission({ safetySnapshot, usageEvidence: evidence, budgetLedger, requests });
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.includes("free_plan_usage_evidence_not_validated"));
  }
});

test("complete dry-run evidence can be eligible for separate release review, never execution", () => {
  const evidence = validateUsageEvidence(usage(), { nowMs: NOW });
  const result = evaluateRuntimeAdmission({ safetySnapshot, usageEvidence: evidence, budgetLedger, requests });
  assert.equal(result.status, "eligible_for_separate_release_review");
  assert.equal(result.approvedForReview.length, 1);
  assert.equal(result.executionStarted, false);
  assert.equal(result.reservationPersisted, false);
  assert.deepEqual(result.sideEffects, []);
});

test("admission blocks partial internal budget and any unsafe runtime flags", () => {
  const evidence = validateUsageEvidence(usage(), { nowMs: NOW });
  const partial = evaluateRuntimeAdmission({
    safetySnapshot, usageEvidence: evidence, budgetLedger,
    requests: [{ id: "task-1", type: "content.review", units: 9 }],
  });
  assert.equal(partial.status, "blocked");
  assert.ok(partial.blockers.includes("some_tasks_exceed_internal_capacity"));

  const unsafe = evaluateRuntimeAdmission({
    safetySnapshot: { ...safetySnapshot, agentPaused: false },
    usageEvidence: evidence, budgetLedger, requests,
  });
  assert.equal(unsafe.status, "blocked");
  assert.ok(unsafe.blockers.includes("safety_gate_not_clear"));
});
