import { heartbeatLease, completeLeasedTask } from "./lease-policy.mjs";

const MAX_NOW = Number.MAX_SAFE_INTEGER;
const CONTROL_FIELDS = ["paused", "emergencyStopped"];
const ROW_FIELDS = [
  "state",
  "lease_owner",
  "lease_generation",
  "lease_expires_at",
  "lease_max_expires_at",
];
const BASE_INPUT_FIELDS = [
  "operation",
  "row",
  "now",
  "leaseOwner",
  "leaseGeneration",
];
const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"];

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length &&
    actual.every((key, index) => key === allowed[index]);
}

function validControl(control) {
  return isPlainRecord(control) &&
    exactKeys(control, CONTROL_FIELDS) &&
    typeof control.paused === "boolean" &&
    typeof control.emergencyStopped === "boolean";
}

function validRow(row, { allowTerminalDuplicate = false } = {}) {
  if (!isPlainRecord(row) || !exactKeys(row, ROW_FIELDS) ||
      !Number.isSafeInteger(row.lease_generation) || row.lease_generation < 1) {
    return false;
  }

  if (allowTerminalDuplicate && TERMINAL_STATUSES.includes(row.state)) {
    return row.lease_owner === null &&
      row.lease_expires_at === null &&
      row.lease_max_expires_at === null;
  }

  return row.state === "running" &&
    typeof row.lease_owner === "string" &&
    /^[a-f0-9-]{16,64}$/i.test(row.lease_owner) &&
    Number.isSafeInteger(row.lease_expires_at) && row.lease_expires_at >= 0 &&
    Number.isSafeInteger(row.lease_max_expires_at) &&
    row.lease_max_expires_at >= row.lease_expires_at;
}

function validLeaseIdentity(owner, generation) {
  return typeof owner === "string" &&
    /^[a-f0-9-]{16,64}$/i.test(owner) &&
    Number.isSafeInteger(generation) && generation >= 1;
}

function freezeResult(result) {
  Object.freeze(result.sideEffects);
  return Object.freeze(result);
}

function reject(reason) {
  return freezeResult({
    ok: false,
    mode: "simulation",
    execution: "not_started",
    persistence: "not_started",
    blocked: true,
    accepted: false,
    reason,
    plannedState: null,
    leaseExpiresAt: null,
    sideEffects: [],
  });
}

/**
 * Simulates a single heartbeat or completion fencing decision.
 * The pure lease policy is evaluated locally; no State Store request,
 * persistence, executor, timer, or external side effect is performed.
 */
export function planLeaseFenceDecision(input, { controlSnapshot } = {}) {
  if (!isPlainRecord(input)) return reject("lease_fence_input_invalid");

  const operation = input.operation;
  const expectedFields = operation === "heartbeat"
    ? BASE_INPUT_FIELDS
    : operation === "complete"
      ? [...BASE_INPUT_FIELDS, "status", ...(Object.hasOwn(input, "errorCode") ? ["errorCode"] : [])]
      : [];

  if (expectedFields.length === 0 || !exactKeys(input, expectedFields)) {
    return reject("lease_fence_fields_invalid");
  }
  if (!Number.isSafeInteger(input.now) || input.now < 0 || input.now > MAX_NOW) {
    return reject("lease_fence_clock_invalid");
  }
  if (!validRow(input.row, { allowTerminalDuplicate: operation === "complete" }) ||
      !validLeaseIdentity(input.leaseOwner, input.leaseGeneration)) {
    return reject("lease_fence_identity_or_row_invalid");
  }
  if (!validControl(controlSnapshot)) {
    return reject("control_snapshot_invalid");
  }

  if (operation === "complete" &&
      (!TERMINAL_STATUSES.includes(input.status) ||
       (input.status === "failed" &&
        (typeof input.errorCode !== "string" || !/^[a-z0-9_.:-]{1,64}$/i.test(input.errorCode))) ||
       (input.status !== "failed" && Object.hasOwn(input, "errorCode")))) {
    return reject("lease_fence_terminal_status_invalid");
  }

  if (controlSnapshot.paused || controlSnapshot.emergencyStopped) {
    return freezeResult({
      ok: true,
      mode: "simulation",
      execution: "not_started",
      persistence: "not_started",
      blocked: true,
      accepted: false,
      reason: controlSnapshot.emergencyStopped
        ? "emergency_stop_active"
        : "runtime_paused",
      plannedState: "running",
      leaseExpiresAt: null,
      sideEffects: [],
    });
  }

  const result = operation === "heartbeat"
    ? heartbeatLease(input.row, {
        now: input.now,
        leaseOwner: input.leaseOwner,
        leaseGeneration: input.leaseGeneration,
      })
    : completeLeasedTask(input.row, {
        now: input.now,
        leaseOwner: input.leaseOwner,
        leaseGeneration: input.leaseGeneration,
        status: input.status,
        ...(Object.hasOwn(input, "errorCode") ? { errorCode: input.errorCode } : {}),
      });

  if (!result.ok) {
    return freezeResult({
      ok: true,
      mode: "simulation",
      execution: "not_started",
      persistence: "not_started",
      blocked: true,
      accepted: false,
      reason: result.error,
      plannedState: "running",
      leaseExpiresAt: null,
      sideEffects: [],
    });
  }

  const plannedState = operation === "heartbeat"
    ? "running"
    : result.duplicate ? input.status : result.fields.state;

  return freezeResult({
    ok: true,
    mode: "simulation",
    execution: "not_started",
    persistence: "not_started",
    blocked: false,
    accepted: true,
    reason: result.duplicate ? "duplicate_terminal_completion" : null,
    plannedState,
    leaseExpiresAt: operation === "heartbeat"
      ? result.fields.lease_expires_at
      : null,
    sideEffects: [],
  });
}
