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

test("audit inspector recognizes runtime terminal-failure and circuit-breaker annotations", () => {
  const snapshotEvents = [
    { eventId: "evt-1", taskId: "task-001", eventType: "task.queued", occurredAt: NOW - 5000, metadata: { taskType: "content.review" } },
    { eventId: "evt-2", taskId: "task-001", eventType: "task.claimed", occurredAt: NOW - 4000, metadata: { attempt: 1, leaseGeneration: 1 } },
    { eventId: "evt-3", taskId: "task-001", eventType: "task.failed", occurredAt: NOW - 3000, metadata: { taskType: "content.review", leaseGeneration: 1 } },
    { eventId: "evt-4", taskId: "task-001", eventType: "task.terminal_failure", occurredAt: NOW - 2000, metadata: { errorCode: "upstream_unavailable" } },
    { eventId: "evt-5", taskId: "task-001", eventType: "runtime.circuit_breaker_auto_pause", occurredAt: NOW - 1000, metadata: { failureCount: 5, cancelledRunningTasks: 2, threshold: 5, windowMs: 600000 } },
  ];
  const result = inspectAuditIntegrity({
    tasks: [task({ state: "failed", updatedAt: NOW - 1000, terminalAt: NOW - 3000 })],
    events: snapshotEvents,
  }, { nowMs: NOW });
  assert.equal(result.status, "consistent");
  assert.deepEqual(result.summary, { errors: 0, warnings: 0, checkedTasks: 1, checkedEvents: 5 });
});

test("audit inspector uses lifecycle order for same-time events with random event IDs", () => {
  const timestamp = NOW - 1000;
  const result = inspectAuditIntegrity({
    tasks: [task({ state: "failed", updatedAt: timestamp, terminalAt: timestamp })],
    events: [
      { eventId: "a-runtime", taskId: "task-001", eventType: "runtime.circuit_breaker_auto_pause", occurredAt: timestamp, metadata: { failureCount: 5, cancelledRunningTasks: 2, threshold: 5, windowMs: 600000 } },
      { eventId: "b-annotation", taskId: "task-001", eventType: "task.terminal_failure", occurredAt: timestamp, metadata: { errorCode: "upstream_unavailable" } },
      { eventId: "c-failed", taskId: "task-001", eventType: "task.failed", occurredAt: timestamp, metadata: { taskType: "content.review", leaseGeneration: 1 } },
      { eventId: "d-claimed", taskId: "task-001", eventType: "task.claimed", occurredAt: timestamp, metadata: { attempt: 1, leaseGeneration: 1 } },
      { eventId: "e-queued", taskId: "task-001", eventType: "task.queued", occurredAt: timestamp, metadata: { taskType: "content.review" } },
    ],
  }, { nowMs: NOW });
  assert.equal(result.status, "review_required");
  assert.equal(result.summary.errors, 0);
  assert.equal(result.summary.warnings, 4);
  assert.ok(result.findings.every(x => x.code === "audit_timestamp_tie_order_ambiguous"));
});

test("audit inspector rejects malformed terminal-failure and circuit-breaker annotations", () => {
  const snapshotEvents = [
    { eventId: "evt-1", taskId: "task-001", eventType: "task.queued", occurredAt: NOW - 5000, metadata: {} },
    { eventId: "evt-2", taskId: "task-001", eventType: "task.claimed", occurredAt: NOW - 4000, metadata: { attempt: 1, leaseGeneration: 1 } },
    { eventId: "evt-3", taskId: "task-001", eventType: "task.failed", occurredAt: NOW - 3000, metadata: { leaseGeneration: 1 } },
    { eventId: "evt-4", taskId: "task-001", eventType: "task.terminal_failure", occurredAt: NOW - 2000, metadata: { errorCode: "INVALID CODE" } },
    { eventId: "evt-5", taskId: "task-001", eventType: "runtime.circuit_breaker_auto_pause", occurredAt: NOW - 1000, metadata: { failureCount: 1, cancelledRunningTasks: -1, threshold: 5, windowMs: 0 } },
  ];
  const result = inspectAuditIntegrity({
    tasks: [task({ state: "failed", updatedAt: NOW - 1000, terminalAt: NOW - 3000 })],
    events: snapshotEvents,
  }, { nowMs: NOW });
  assert.equal(result.status, "integrity_error");
  assert.ok(result.findings.some(x => x.code === "terminal_failure_annotation_invalid"));
  assert.ok(result.findings.some(x => x.code === "circuit_breaker_annotation_invalid"));
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

test("audit inspector rejects partially cleared lease fields on terminal tasks", () => {
  for (const partial of [
    { leaseOwner: "worker-1234567890", leaseExpiresAt: null },
    { leaseOwner: null, leaseExpiresAt: NOW + 1000 },
  ]) {
    const result = inspectAuditIntegrity({
      tasks: [task({ ...partial })],
      events: events(),
    }, { nowMs: NOW });
    assert.equal(result.status, "integrity_error");
    assert.ok(result.findings.some(x => x.code === "task_lease_state_inconsistent"));
  }
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

test("audit inspector accepts a running lease cancelled by the circuit breaker", () => {
  const result = inspectAuditIntegrity({
    tasks: [task({ state: "cancelled", attemptCount: 1, leaseGeneration: 1 })],
    events: [
      { eventId: "q", taskId: "task-001", eventType: "task.queued", occurredAt: NOW - 5000, metadata: {} },
      { eventId: "c", taskId: "task-001", eventType: "task.claimed", occurredAt: NOW - 3000, metadata: { attempt: 1, leaseGeneration: 1 } },
      { eventId: "x", taskId: "task-001", eventType: "task.cancelled", occurredAt: NOW - 1000, metadata: { taskType: "content.review", leaseGeneration: 1 } },
    ],
  }, { nowMs: NOW });
  assert.equal(result.status, "consistent");
});

test("audit inspector flags tasks with no audit events as incomplete evidence", () => {
  const result = inspectAuditIntegrity({ tasks: [task()], events: [] }, { nowMs: NOW });
  assert.equal(result.status, "integrity_error");
  assert.ok(result.findings.some(x => x.code === "task_without_audit_events"));
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

test("audit inspector paginates every task missing audit events without losing IDs", () => {
  const tasks = Array.from({ length: 101 }, (_, index) => task({ taskId: "task-" + String(index + 1).padStart(3, "0") }));
  const snapshot = { tasks, events: [] };
  const first = inspectAuditIntegrity(snapshot, { nowMs: NOW });
  assert.equal(first.findings.length, 100);
  assert.equal(first.pagination.total, 101);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(first.pagination.nextOffset, 100);
  const second = inspectAuditIntegrity(snapshot, { nowMs: NOW, findingOffset: first.pagination.nextOffset });
  assert.equal(second.findings.length, 1);
  assert.equal(second.findings[0].taskId, "task-101");
  assert.equal(second.pagination.hasMore, false);
  assert.equal(second.pagination.nextOffset, null);
  assert.equal(second.summary.errors, 101);
});

test("audit inspector rejects unbounded finding page requests", () => {
  assert.equal(inspectAuditIntegrity({ tasks: [], events: [] }, { nowMs: NOW, findingLimit: 101 }).status, "evidence_incomplete");
  assert.equal(inspectAuditIntegrity({ tasks: [], events: [] }, { nowMs: NOW, findingOffset: -1 }).status, "evidence_incomplete");
});
