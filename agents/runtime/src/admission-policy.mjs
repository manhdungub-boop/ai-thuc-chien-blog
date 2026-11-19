const LIMIT_CAPS = Object.freeze({
  maxTasksPerDay: 100,
  maxConcurrent: 5,
  maxPayloadBytes: 8 * 1024,
});

const LIMIT_KEYS = Object.keys(LIMIT_CAPS).sort();
const USAGE_KEYS = ["acceptedToday", "inFlight"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isBoundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

/**
 * Pure admission decision only. It does not count, reserve, enqueue, or persist work.
 * Missing or untrusted limits/usage always fail closed.
 */
export function evaluateAdmission(input) {
  if (!isRecord(input)) return { ok: false, reason: "admission_input_invalid" };

  if (input.enabled !== true) return { ok: false, reason: "agent_disabled" };
  if (input.paused !== false) return { ok: false, reason: "agent_paused" };

  if (!hasExactKeys(input.limits, LIMIT_KEYS)) {
    return { ok: false, reason: "limits_missing_or_invalid" };
  }
  if (!isBoundedInteger(input.limits.maxTasksPerDay, 1, LIMIT_CAPS.maxTasksPerDay) ||
      !isBoundedInteger(input.limits.maxConcurrent, 1, LIMIT_CAPS.maxConcurrent) ||
      !isBoundedInteger(input.limits.maxPayloadBytes, 1, LIMIT_CAPS.maxPayloadBytes)) {
    return { ok: false, reason: "limits_missing_or_invalid" };
  }

  if (!hasExactKeys(input.usage, USAGE_KEYS) ||
      !isBoundedInteger(input.usage.acceptedToday, 0, Number.MAX_SAFE_INTEGER) ||
      !isBoundedInteger(input.usage.inFlight, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "usage_missing_or_invalid" };
  }

  if (!isBoundedInteger(input.payloadBytes, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "payload_size_invalid" };
  }

  if (input.usage.acceptedToday >= input.limits.maxTasksPerDay) {
    return { ok: false, reason: "daily_quota_exhausted" };
  }
  if (input.usage.inFlight >= input.limits.maxConcurrent) {
    return { ok: false, reason: "concurrency_limit_reached" };
  }
  if (input.payloadBytes > input.limits.maxPayloadBytes) {
    return { ok: false, reason: "payload_limit_exceeded" };
  }

  return { ok: true, reason: "admitted" };
}

export const ADMISSION_LIMIT_CAPS = LIMIT_CAPS;
