const COMPONENTS = Object.freeze(["stateStore", "workerBridge", "usageEvidence"]);
const MAX_HEARTBEAT_AGE_MS = 15 * 60 * 1000;
const MAX_RUNNING_TASKS = 5;
const MAX_QUEUED_TASKS = 100;

function issue(code, severity) {
  return Object.freeze({ code, severity });
}

function invalid(code) {
  return Object.freeze({
    ok: false,
    mode: "read_only_health_monitor",
    status: "evidence_incomplete",
    issues: Object.freeze([issue(code, "error")]),
    sideEffects: Object.freeze([]),
    recoveryRequired: false,
  });
}

/**
 * Evaluates a caller-supplied operational snapshot; does not poll or contact services.
 * A healthy result describes only the supplied observation, never continuous uptime.
 */
export function evaluateAgentHealthSnapshot(snapshot, { nowMs = Date.now() } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      !Number.isSafeInteger(nowMs) || typeof snapshot.observedAt !== "string") {
    return invalid("health_snapshot_invalid");
  }
  const observedAtMs = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedAtMs) || new Date(observedAtMs).toISOString() !== snapshot.observedAt ||
      observedAtMs > nowMs || nowMs - observedAtMs > MAX_HEARTBEAT_AGE_MS) {
    return invalid("health_observation_stale_or_invalid");
  }

  if (!snapshot.components || typeof snapshot.components !== "object" ||
      Array.isArray(snapshot.components) ||
      COMPONENTS.some(name => !["healthy", "degraded", "unavailable"].includes(snapshot.components[name]))) {
    return invalid("health_component_evidence_invalid");
  }
  for (const field of ["heartbeatAgeMs", "queuedTasks", "runningTasks", "expiredLeases"]) {
    if (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0) return invalid("health_metric_invalid:" + field);
  }
  if (snapshot.heartbeatAgeMs > MAX_HEARTBEAT_AGE_MS ||
      snapshot.queuedTasks > MAX_QUEUED_TASKS ||
      snapshot.runningTasks > MAX_RUNNING_TASKS) return invalid("health_metric_out_of_bounds");

  const issues = [];
  for (const name of COMPONENTS) {
    if (snapshot.components[name] === "unavailable") issues.push(issue("component_unavailable:" + name, "error"));
    if (snapshot.components[name] === "degraded") issues.push(issue("component_degraded:" + name, "warning"));
  }
  if (snapshot.expiredLeases > 0) issues.push(issue("expired_lease_detected", "error"));
  if (snapshot.heartbeatAgeMs > 5 * 60 * 1000) issues.push(issue("heartbeat_delayed", "warning"));
  if (snapshot.runningTasks === MAX_RUNNING_TASKS) issues.push(issue("running_task_capacity_reached", "warning"));
  if (snapshot.queuedTasks === MAX_QUEUED_TASKS) issues.push(issue("queue_capacity_reached", "warning"));

  const status = issues.some(x => x.severity === "error")
    ? "critical"
    : issues.length ? "degraded" : "healthy";

  return Object.freeze({
    ok: true,
    mode: "read_only_health_monitor",
    status,
    observedAt: snapshot.observedAt,
    ageMs: nowMs - observedAtMs,
    issues: Object.freeze(issues),
    recoveryRequired: status === "critical",
    sideEffects: Object.freeze([]),
    limitations: Object.freeze([
      "single_caller_supplied_observation",
      "no_live_polling_or_service_authentication",
      "not_a_continuous_uptime_or_sla_measurement",
    ]),
  });
}

export const AGENT_HEALTH_POLICY = Object.freeze({
  components: COMPONENTS,
  maxObservationAgeMs: MAX_HEARTBEAT_AGE_MS,
  maxRunningTasks: MAX_RUNNING_TASKS,
  maxQueuedTasks: MAX_QUEUED_TASKS,
  pollsServices: false,
  mutatesRuntime: false,
});
