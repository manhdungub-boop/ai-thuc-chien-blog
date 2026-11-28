const TASK_STATES = new Set(["queued", "running", "succeeded", "failed", "cancelled"]);
const EVENT_TYPES = new Set([
  "task.queued", "task.claimed", "task.lease_heartbeat",
  "task.succeeded", "task.failed", "task.cancelled",
  "task.lease_expired_requeued", "task.lease_expired_failed",
  "task.terminal_failure", "runtime.circuit_breaker_auto_pause",
]);
const EVENT_ORDER = new Map([
  ["task.queued", 10],
  ["task.claimed", 20],
  ["task.lease_heartbeat", 30],
  ["task.lease_expired_requeued", 35],
  ["task.lease_expired_failed", 35],
  ["task.succeeded", 40],
  ["task.failed", 40],
  ["task.cancelled", 40],
  ["task.terminal_failure", 50],
  ["runtime.circuit_breaker_auto_pause", 60],
]);
const MAX_TASKS = 1000;
const MAX_EVENTS = 5000;
const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function finding(code, severity, taskId = null, eventId = null) {
  return Object.freeze({ code, severity, taskId, eventId });
}
function invalid(code) {
  return Object.freeze({
    ok: false, mode: "read_only_audit_integrity",
    status: "evidence_incomplete",
    findings: Object.freeze([finding(code, "error")]),
    summary: Object.freeze({ errors: 1, warnings: 0, checkedTasks: 0, checkedEvents: 0 }),
    sideEffects: Object.freeze([]),
  });
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Cross-checks bounded task and audit snapshots exported by a trusted read-only adapter.
 * This function does not query SQLite, authenticate a source, mutate records or repair gaps.
 */
export function inspectAuditIntegrity(snapshot, { nowMs = Date.now(), findingOffset = 0, findingLimit = 100 } = {}) {
  if (!record(snapshot) || !Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.events) ||
      snapshot.tasks.length > MAX_TASKS || snapshot.events.length > MAX_EVENTS ||
      !Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(findingOffset) || findingOffset < 0 ||
      !Number.isSafeInteger(findingLimit) || findingLimit < 1 || findingLimit > 100) return invalid("audit_snapshot_invalid");

  const findings = [];
  const tasks = new Map();
  for (const task of snapshot.tasks) {
    if (!record(task) || typeof task.taskId !== "string" || !/^[a-zA-Z0-9._:-]{1,64}$/.test(task.taskId) ||
        !TASK_STATES.has(task.state) || !Number.isSafeInteger(task.createdAt) || task.createdAt < 0 ||
        !Number.isSafeInteger(task.updatedAt) || task.updatedAt < task.createdAt ||
        !Number.isSafeInteger(task.attemptCount) || task.attemptCount < 0 || task.attemptCount > 5 ||
        !Number.isSafeInteger(task.leaseGeneration) || task.leaseGeneration < 0 ||
        !Number.isSafeInteger(task.maxAttempts) || task.maxAttempts < 1 || task.maxAttempts > 5) {
      return invalid("task_snapshot_record_invalid");
    }
    if (tasks.has(task.taskId)) findings.push(finding("duplicate_task_id", "error", task.taskId));
    else tasks.set(task.taskId, task);

    const hasLeaseOwner = typeof task.leaseOwner === "string" && task.leaseOwner.length > 0;
    const hasLeaseExpiry = Number.isSafeInteger(task.leaseExpiresAt);
    const activeLease = task.state === "running";
    if (activeLease ? (!hasLeaseOwner || !hasLeaseExpiry) : (hasLeaseOwner || hasLeaseExpiry)) {
      findings.push(finding("task_lease_state_inconsistent", "error", task.taskId));
    }
    if (task.state === "running" && task.leaseExpiresAt <= nowMs) {
      findings.push(finding("task_lease_expired_but_running", "error", task.taskId));
    }
    if (["succeeded", "failed", "cancelled"].includes(task.state) !== Number.isSafeInteger(task.terminalAt)) {
      findings.push(finding("task_terminal_timestamp_inconsistent", "error", task.taskId));
    }
    if (task.attemptCount > task.leaseGeneration || task.leaseGeneration > task.attemptCount) {
      findings.push(finding("task_attempt_generation_mismatch", "error", task.taskId));
    }
  }

  const eventIds = new Set();
  const grouped = new Map();
  for (const event of snapshot.events) {
    if (!record(event) || typeof event.eventId !== "string" || event.eventId.length < 1 || event.eventId.length > 64 ||
        typeof event.taskId !== "string" || !/^[a-zA-Z0-9._:-]{1,64}$/.test(event.taskId) ||
        typeof event.eventType !== "string" || !Number.isSafeInteger(event.occurredAt) ||
        event.occurredAt < 0 || event.occurredAt > nowMs || !record(event.metadata)) {
      return invalid("audit_event_record_invalid");
    }
    if (eventIds.has(event.eventId)) findings.push(finding("duplicate_event_id", "error", event.taskId, event.eventId));
    eventIds.add(event.eventId);
    if (!EVENT_TYPES.has(event.eventType)) {
      findings.push(finding("unknown_event_type", "error", event.taskId, event.eventId));
      continue;
    }
    if (!grouped.has(event.taskId)) grouped.set(event.taskId, []);
    grouped.get(event.taskId).push(event);
  }

  for (const [taskId, events] of grouped) {
    const task = tasks.get(taskId);
    if (!task) {
      const newest = Math.max(...events.map(event => event.occurredAt));
      findings.push(finding(
        nowMs - newest > TASK_RETENTION_MS ? "audit_task_missing_after_retention_window" : "audit_task_missing",
        nowMs - newest > TASK_RETENTION_MS ? "warning" : "error", taskId,
      ));
      continue;
    }
    events.sort((a, b) => a.occurredAt - b.occurredAt ||
      (EVENT_ORDER.get(a.eventType) ?? 100) - (EVENT_ORDER.get(b.eventType) ?? 100) ||
      a.eventId.localeCompare(b.eventId));
    for (let i = 1; i < events.length; i++) {
      if (events[i].occurredAt === events[i - 1].occurredAt) {
        findings.push(finding("audit_timestamp_tie_order_ambiguous", "warning", taskId, events[i].eventId));
      }
    }
    let state = null;
    let generation = 0;
    let lastAt = task.createdAt;
    for (const event of events) {
      if (event.occurredAt < lastAt) findings.push(finding("audit_timestamp_regression", "error", taskId, event.eventId));
      lastAt = Math.max(lastAt, event.occurredAt);
      const meta = event.metadata;
      if (event.eventType === "task.terminal_failure") {
        if (state !== "failed" || typeof meta.errorCode !== "string" ||
            !/^[a-z0-9_.:-]{1,64}$/.test(meta.errorCode)) {
          findings.push(finding("terminal_failure_annotation_invalid", "error", taskId, event.eventId));
        }
      } else if (event.eventType === "runtime.circuit_breaker_auto_pause") {
        if (state !== "failed" || !Number.isSafeInteger(meta.failureCount) ||
            !Number.isSafeInteger(meta.threshold) || meta.failureCount < meta.threshold ||
            !Number.isSafeInteger(meta.cancelledRunningTasks) || meta.cancelledRunningTasks < 0 ||
            !Number.isSafeInteger(meta.windowMs) || meta.windowMs < 1) {
          findings.push(finding("circuit_breaker_annotation_invalid", "error", taskId, event.eventId));
        }
      } else if (event.eventType === "task.queued") {
        if (state !== null) findings.push(finding("duplicate_or_unexpected_queued_event", "error", taskId, event.eventId));
        state = "queued";
      } else if (event.eventType === "task.claimed") {
        if (state !== "queued" || !Number.isSafeInteger(meta.leaseGeneration) ||
            meta.leaseGeneration !== generation + 1 || !Number.isSafeInteger(meta.attempt)) {
          findings.push(finding("claim_event_transition_invalid", "error", taskId, event.eventId));
        } else {
          generation = meta.leaseGeneration;
          state = "running";
        }
      } else if (event.eventType === "task.lease_heartbeat") {
        if (state !== "running" || meta.leaseGeneration !== generation) {
          findings.push(finding("heartbeat_event_without_current_claim", "error", taskId, event.eventId));
        }
      } else if (event.eventType === "task.lease_expired_requeued" || event.eventType === "task.lease_expired_failed") {
        if (state !== "running" || meta.leaseGeneration !== generation || !Number.isSafeInteger(meta.attempt)) {
          findings.push(finding("lease_recovery_event_transition_invalid", "error", taskId, event.eventId));
        }
        state = event.eventType === "task.lease_expired_requeued" ? "queued" : "failed";
      } else {
        const next = event.eventType.slice("task.".length);
        const allowed = next === "cancelled" ? state === "queued" || state === "running" : state === "running";
        if (!allowed || (state === "running" && meta.leaseGeneration !== generation)) {
          findings.push(finding("terminal_event_transition_invalid", "error", taskId, event.eventId));
        }
        state = next;
      }
    }
    if (state !== task.state) findings.push(finding("task_state_does_not_match_audit_tail", "error", taskId));
    if (generation !== task.leaseGeneration) findings.push(finding("audit_lease_generation_mismatch", "error", taskId));
    if (events.some(event => event.occurredAt > task.updatedAt)) {
      findings.push(finding("audit_event_after_task_update", "error", taskId));
    }
  }

  for (const taskId of tasks.keys()) {
    if (!grouped.has(taskId)) findings.push(finding("task_without_audit_events", "error", taskId));
  }

  const errors = findings.filter(item => item.severity === "error").length;
  const warnings = findings.filter(item => item.severity === "warning").length;
  return Object.freeze({
    ok: true,
    mode: "read_only_audit_integrity",
    status: errors ? "integrity_error" : warnings ? "review_required" : "consistent",
    findings: Object.freeze(findings.slice(findingOffset, findingOffset + findingLimit)),
    pagination: Object.freeze({
      offset: findingOffset,
      limit: findingLimit,
      total: findings.length,
      hasMore: findingOffset + findingLimit < findings.length,
      nextOffset: findingOffset + findingLimit < findings.length ? findingOffset + findingLimit : null,
    }),
    summary: Object.freeze({ errors, warnings, checkedTasks: tasks.size, checkedEvents: eventIds.size }),
    sideEffects: Object.freeze([]),
    limitations: Object.freeze([
      "caller_supplied_snapshot_only",
      "no_source_authentication_or_live_database_read",
      "cannot_prove_events_were_never_deleted_or_tampered_with",
      "timestamp_ties_are_not_a_total_order",
    ]),
  });
}

export const AUDIT_INTEGRITY_POLICY = Object.freeze({
  maxTasks: MAX_TASKS,
  maxEvents: MAX_EVENTS,
  taskRetentionMs: TASK_RETENTION_MS,
  readsDatabase: false,
  mutatesRecords: false,
  repairsAuditGaps: false,
});
