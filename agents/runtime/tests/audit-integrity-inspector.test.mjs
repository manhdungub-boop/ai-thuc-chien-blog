import test from "node:test";
import assert from "node:assert/strict";
import { inspectAuditIntegrity } from "../src/audit-integrity-inspector.mjs";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const task = (overrides = {}) => ({
  taskId: "task-001", state: "succeeded", createdAt: NOW - 5000, updatedAt: NOW - 1000,
  terminalAt: NOW - 1000, attemptCount: 1, maxAttempts: 3, leaseGeneration: 1,
  leaseOwner: null, leaseExpiresAt: null, ...overrides,
});
const events = () => [
  { eventId: "evt-1", taskId: "task-001", eventType: "task.queued", occurredAt: NOW - 5000, metadata: { taskType: "content.review" } },
  { eventId: "evt-2", taskId: "task-001", eventType: "task.claimed", occurredAt: NOW - 3000, metadata: { attempt: 1, leaseGeneration: 1 } },
  { eventId: "evt-3", taskId: "task-001", eventType: "task.succeeded", occurredAt: NOW - 1000, metadata: { taskType: "content.review", leaseGeneration: 1 } },
];

test("audit inspector accepts a consistent queued-claimed-terminal lifecycle", () => {
  const result = inspectAuditIntegrity({ tasks: [task()], events: events() }, { nowMs: NOW });
  assert.equal(result.status, "consistent");
  assert.deepEqual(result.summary, { errors: 0, warnings: 0, checkedTasks: 1, checkedEvents: 3 });
  assert.deepEqual(result.sideEffects, []);
});

test("audit inspector detects a missing lifecycle event and task/audit state mismatch", () => {
  const result = inspectAuditIntegrity({ tasks: [task()], events: events().slice(0, 2) }, { nowMs: NOW });
  assert.equal(result.status, "integrity_error");
  assert.ok(result.findings.some(x => x.code === "task_state_does_not_match_audit_tail"));
});

test("audit inspector detects duplicate event IDs, unknown events and invalid transition order", () => {
  const bad = events();
  bad[1] = { ...bad[1], eventType: "task.succeeded" };
  bad.push({ ...bad[2], eventId: "evt-3", eventType: "task.future" });
  const result = inspectAuditIntegrity({ tasks: [task()], events: bad }, { nowMs: NOW });
  assert.equal(result.status, "integrity_error");
  assert.ok(result.findings.some(x => x.code === "terminal_event_transition_invalid"));
  assert.ok(result.findings.some(x => x.code === "duplicate_event_id"));
  assert.ok(result.findings.some(x => x.code === "unknown_event_type"));
});

test("audit inspector checks lease generations and task lease fields", () => {
  const result = inspectAuditIntegrity({
    tasks: [task({ leaseGeneration: 2, leaseOwner: "worker-1234567890", leaseExpiresAt: NOW + 1000 })],
    events: events(),
  }, { nowMs: NOW });
  assert.equal(result.status, "integrity_error");
  assert.ok(result.findings.some(x => x.code === "task_lease_state_inconsistent"));
  assert.ok(result.findings.some(x => x.code === "audit_lease_generation_mismatch"));
});

test("audit events older than task retention are warnings, not false corruption claims", () => {
  const old = NOW - 40 * 24 * 60 * 60 * 1000;
  const result = inspectAuditIntegrity({
    tasks: [],
    events: [{ eventId: "old-1", taskId: "task-gone", eventType: "task.queued", occurredAt: old, metadata: {} }],
  }, { nowMs: NOW });
  assert.equal(result.status, "review_required");
  assert.ok(result.findings.some(x => x.code === "audit_task_missing_after_retention_window"));
});

test("audit inspector fails closed on oversized or malformed snapshots", () => {
  assert.equal(inspectAuditIntegrity({ tasks: "bad", events: [] }, { nowMs: NOW }).status, "evidence_incomplete");
  assert.equal(inspectAuditIntegrity({ tasks: [], events: [{ eventId: "e", taskId: "x", eventType: "task.queued", occurredAt: NOW + 1, metadata: {} }] }, { nowMs: NOW }).status, "evidence_incomplete");
});

test("queued cancellation lifecycle is recognized without a lease", () => {
  const result = inspectAuditIntegrity({
    tasks: [task({ state: "cancelled", attemptCount: 0, leaseGeneration: 0 })],
    events: [
      { eventId: "q", taskId: "task-001", eventType: "task.queued", occurredAt: NOW - 5000, metadata: {} },
      { eventId: "c", taskId: "task-001", eventType: "task.cancelled", occurredAt: NOW - 1000, metadata: { taskType: "content.review" } },
    ],
  }, { nowMs: NOW });
  assert.equal(result.status, "consistent");
});
