import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAdmission, ADMISSION_LIMIT_CAPS } from "../src/admission-policy.mjs";

const valid = (overrides = {}) => ({
  enabled: true,
  paused: false,
  limits: { maxTasksPerDay: 100, maxConcurrent: 5, maxPayloadBytes: 4096 },
  usage: { acceptedToday: 0, inFlight: 0 },
  payloadBytes: 1024,
  ...overrides,
});

test("hard safety caps match the documented Free-tier pilot limits", () => {
  assert.deepEqual(ADMISSION_LIMIT_CAPS, {
    maxTasksPerDay: 100,
    maxConcurrent: 5,
    maxPayloadBytes: 8 * 1024,
  });
});

test("admits a request strictly below all configured limits", () => {
  assert.deepEqual(evaluateAdmission(valid()), { ok: true, reason: "admitted" });
});

test("rejects disabled or paused runtime before considering capacity", () => {
  assert.equal(evaluateAdmission(valid({ enabled: false })).reason, "agent_disabled");
  assert.equal(evaluateAdmission(valid({ paused: true })).reason, "agent_paused");
});

test("fails closed when limits are missing, malformed, extra, or above safety caps", () => {
  assert.equal(evaluateAdmission(valid({ limits: undefined })).reason, "limits_missing_or_invalid");
  assert.equal(evaluateAdmission(valid({ limits: { maxTasksPerDay: 100 } })).reason, "limits_missing_or_invalid");
  assert.equal(evaluateAdmission(valid({ limits: { ...valid().limits, extra: 1 } })).reason, "limits_missing_or_invalid");
  assert.equal(evaluateAdmission(valid({ limits: { ...valid().limits, maxConcurrent: ADMISSION_LIMIT_CAPS.maxConcurrent + 1 } })).reason, "limits_missing_or_invalid");
  assert.equal(evaluateAdmission(valid({ limits: { ...valid().limits, maxTasksPerDay: 0 } })).reason, "limits_missing_or_invalid");
});

test("fails closed when usage counters are missing, malformed, negative, or extra", () => {
  assert.equal(evaluateAdmission(valid({ usage: undefined })).reason, "usage_missing_or_invalid");
  assert.equal(evaluateAdmission(valid({ usage: { acceptedToday: 0 } })).reason, "usage_missing_or_invalid");
  assert.equal(evaluateAdmission(valid({ usage: { acceptedToday: -1, inFlight: 0 } })).reason, "usage_missing_or_invalid");
  assert.equal(evaluateAdmission(valid({ usage: { acceptedToday: 0, inFlight: 0, unlimited: true } })).reason, "usage_missing_or_invalid");
});

test("rejects daily quota at the exact boundary", () => {
  assert.equal(evaluateAdmission(valid({ usage: { acceptedToday: 100, inFlight: 0 } })).reason, "daily_quota_exhausted");
  assert.equal(evaluateAdmission(valid({ usage: { acceptedToday: 99, inFlight: 0 } })).ok, true);
});

test("rejects concurrency at the exact boundary", () => {
  assert.equal(evaluateAdmission(valid({ usage: { acceptedToday: 0, inFlight: 5 } })).reason, "concurrency_limit_reached");
  assert.equal(evaluateAdmission(valid({ usage: { acceptedToday: 0, inFlight: 4 } })).ok, true);
});

test("rejects invalid and over-limit payload sizes, accepts exact boundary", () => {
  assert.equal(evaluateAdmission(valid({ payloadBytes: -1 })).reason, "payload_size_invalid");
  assert.equal(evaluateAdmission(valid({ payloadBytes: 4097 })).reason, "payload_limit_exceeded");
  assert.equal(evaluateAdmission(valid({ payloadBytes: 4096 })).ok, true);
});

test("rejects non-object admission input", () => {
  assert.equal(evaluateAdmission(null).reason, "admission_input_invalid");
  assert.equal(evaluateAdmission([]).reason, "admission_input_invalid");
});
