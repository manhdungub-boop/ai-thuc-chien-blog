import test from "node:test";
import assert from "node:assert/strict";
import { prioritizeAgentTasks } from "../src/agent-priority-engine.mjs";
import { evaluateAgentBudget, AGENT_BUDGET_POLICY } from "../src/agent-budget-guard.mjs";

const tasks = [
  { id: "seo-1", type: "seo.audit" },
  { id: "bank-1", type: "ai_bank.candidate_review" },
  { id: "content-1", type: "content.review" },
  { id: "content-2", type: "content.review" },
];

test("priority engine ranks task families deterministically and preserves ties", () => {
  const result = prioritizeAgentTasks(tasks);
  assert.equal(result.ok, true);
  assert.deepEqual(result.items.map(x => x.id), ["content-1", "content-2", "bank-1", "seo-1"]);
  assert.deepEqual(result.sideEffects, []);
});

test("priority engine rejects unknown types, duplicate IDs and oversized batches", () => {
  assert.equal(prioritizeAgentTasks([{ id: "x", type: "unknown" }]).ok, false);
  assert.equal(prioritizeAgentTasks([{ id: "x", type: "seo.audit" }, { id: "x", type: "content.review" }]).error, "priority_task_invalid");
  assert.equal(prioritizeAgentTasks(Array(51).fill({ id: "x", type: "seo.audit" })).error, "priority_batch_invalid");
});

const ledger = (overrides = {}) => ({
  verified: true, period: "2026-11-20", dailyLimitUnits: 10,
  consumedUnits: 2, reservedUnits: 1, ...overrides,
});

test("budget guard allocates scarce abstract capacity in priority order", () => {
  const result = evaluateAgentBudget({
    ledger: ledger(),
    requests: [
      { id: "seo-1", type: "seo.audit", units: 5 },
      { id: "content-1", type: "content.review", units: 4 },
      { id: "bank-1", type: "ai_bank.candidate_review", units: 2 },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "partially_approved");
  assert.deepEqual(result.approved.map(x => x.id), ["content-1", "bank-1"]);
  assert.deepEqual(result.rejected.map(x => x.id), ["seo-1"]);
  assert.equal(result.remainingUnits, 1);
  assert.equal(result.unitsAreMonetary, false);
});

test("budget guard fails closed when ledger evidence is absent or unverified", () => {
  assert.equal(evaluateAgentBudget({ requests: [] }).error, "budget_evidence_invalid");
  assert.equal(evaluateAgentBudget({ ledger: ledger({ verified: false }), requests: [] }).status, "blocked");
  assert.equal(evaluateAgentBudget({ ledger: ledger({ dailyLimitUnits: 101 }), requests: [] }).error, "budget_ledger_out_of_bounds");
});

test("budget guard rejects overdrawn ledger, malformed and excessive requests", () => {
  assert.equal(evaluateAgentBudget({ ledger: ledger({ consumedUnits: 9, reservedUnits: 2 }), requests: [] }).error, "budget_ledger_out_of_bounds");
  assert.equal(evaluateAgentBudget({ ledger: ledger(), requests: [{ id: "x", type: "seo.audit", units: 21 }] }).error, "budget_request_invalid");
  assert.equal(evaluateAgentBudget({ ledger: ledger(), requests: Array(21).fill({ id: "x", type: "seo.audit", units: 1 }) }).error, "budget_batch_invalid");
});

test("budget guard never writes reservations or charges money", () => {
  assert.equal(AGENT_BUDGET_POLICY.persistsReservations, false);
  assert.equal(AGENT_BUDGET_POLICY.chargesMoney, false);
  const result = evaluateAgentBudget({ ledger: ledger(), requests: [] });
  assert.deepEqual(result.sideEffects, []);
});
