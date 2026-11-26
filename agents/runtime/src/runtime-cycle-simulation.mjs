import { simulateRuntimeTick } from "./runtime-tick-simulation.mjs";
import { planLeaseRecovery } from "./lease-recovery-simulation.mjs";
import { planLeaseFenceDecision } from "./lease-fencing-simulation.mjs";

const MAX_RECOVERY_ENTRIES = 10;
const MAX_FENCING_DECISIONS = 10;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const INPUT_KEYS = ["fencingInputs", "queueEntries", "recoveryEntries"];
const OPTION_KEYS = ["controlSnapshot", "maxDispatch", "now", "retryDelayMs"];

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length &&
    actual.every((key, index) => key === allowed[index]);
}

function freezeResult(result) {
  for (const decision of result.fencing.decisions) Object.freeze(decision);
  Object.freeze(result.fencing.decisions);
  Object.freeze(result.sideEffects);
  return Object.freeze(result);
}

function reject(reason) {
  return freezeResult({
    ok: false,
    mode: "runtime_cycle_simulation",
    execution: "not_started",
    persistence: "not_started",
    blocked: true,
    reason,
    tick: null,
    recovery: null,
    fencing: { decisions: [] },
    sideEffects: [],
  });
}

/**
 * Composes the bounded tick, expired-lease recovery and lease-fencing
 * simulations into one deterministic, side-effect-free runtime cycle.
 * All timestamps are caller supplied. No persistence, dispatch, lease claim,
 * timer, network, filesystem, queue write, handler or publishing is performed.
 */
export function simulateRuntimeCycle(input, options = {}) {
  if (!isPlainRecord(input) || !hasExactKeys(input, INPUT_KEYS)) {
    return reject("runtime_cycle_input_invalid");
  }
  if (!isPlainRecord(options) ||
      Object.keys(options).some((key) => !OPTION_KEYS.includes(key))) {
    return reject("runtime_cycle_options_invalid");
  }

  const { queueEntries, recoveryEntries, fencingInputs } = input;
  const { now, controlSnapshot } = options;
  const maxDispatch = options.maxDispatch === undefined ? 5 : options.maxDispatch;
  const retryDelayMs = options.retryDelayMs === undefined ? 30_000 : options.retryDelayMs;

  if (!Array.isArray(queueEntries) || queueEntries.length > 20 ||
      !Array.isArray(recoveryEntries) || recoveryEntries.length > MAX_RECOVERY_ENTRIES ||
      !Array.isArray(fencingInputs) || fencingInputs.length > MAX_FENCING_DECISIONS) {
    return reject("runtime_cycle_collection_invalid_or_over_limit");
  }
  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(maxDispatch) || maxDispatch < 1 || maxDispatch > 5 ||
      !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 ||
      retryDelayMs > MAX_RETRY_DELAY_MS ||
      !isPlainRecord(controlSnapshot) ||
      !hasExactKeys(controlSnapshot, ["paused", "emergencyStopped"]) ||
      typeof controlSnapshot.paused !== "boolean" ||
      typeof controlSnapshot.emergencyStopped !== "boolean") {
    return reject("runtime_cycle_options_invalid");
  }

  const tick = simulateRuntimeTick(queueEntries, {
    now,
    maxDispatch,
    controlSnapshot,
  });
  const globalStopActive = controlSnapshot.paused || controlSnapshot.emergencyStopped;
  if (!tick.ok && !globalStopActive) {
    return reject("runtime_cycle_tick_rejected");
  }

  // A global stop is an expected safe outcome, not a malformed cycle.
  // Continue evaluating the pure Recovery and Fencing policies so the caller
  // receives an auditable blocked decision from every stage.
  const recovery = planLeaseRecovery(recoveryEntries, {
    now,
    retryDelayMs,
    controlSnapshot,
  });
  if (!recovery.ok) return reject("runtime_cycle_recovery_rejected");

  const decisions = [];
  for (const fencingInput of fencingInputs) {
    if (!isPlainRecord(fencingInput)) return reject("runtime_cycle_fencing_input_invalid");
    const decision = planLeaseFenceDecision(fencingInput, { controlSnapshot });
    if (!decision.ok) return reject("runtime_cycle_fencing_rejected");
    decisions.push(decision);
  }

  return freezeResult({
    ok: true,
    mode: "runtime_cycle_simulation",
    execution: "not_started",
    persistence: "not_started",
    blocked: globalStopActive || tick.blocked || recovery.blocked || decisions.some((item) => item.blocked),
    reason: globalStopActive
      ? (controlSnapshot.emergencyStopped ? "emergency_stop_active" : "runtime_paused")
      : tick.blocked
        ? tick.reason
        : recovery.blocked
          ? recovery.reason
          : decisions.find((item) => item.blocked)?.reason ?? null,
    tick,
    recovery,
    fencing: { decisions },
    sideEffects: [],
  });
}

export const RUNTIME_CYCLE_SIMULATION_LIMITS = Object.freeze({
  maxQueueEntries: 20,
  maxRecoveryEntries: MAX_RECOVERY_ENTRIES,
  maxFencingDecisions: MAX_FENCING_DECISIONS,
  maxDispatchPerTick: 5,
  maxRetryDelayMs: MAX_RETRY_DELAY_MS,
});
