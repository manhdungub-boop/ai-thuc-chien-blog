import test from "node:test";
import assert from "node:assert/strict";
import { classifyTaskFailure } from "../src/failure-classification.mjs";

test("classifies allowlisted transient failures without retrying", () => {
  assert.deepEqual(classifyTaskFailure("lease_expired_max_attempts", "lease_expired"), {
    category: "transient", confidence: "high", recommendedAction: "inspect_provider_or_network_health",
  });
});

test("classifies authentication, configuration, and data failures", () => {
  assert.equal(classifyTaskFailure("token_expired").category, "authentication");
  assert.equal(classifyTaskFailure("binding_missing").category, "configuration");
  assert.equal(classifyTaskFailure("payload_invalid").category, "data");
});

test("prefers primary error code and falls back to last error code", () => {
  assert.equal(classifyTaskFailure("provider_timeout", "token_expired").category, "transient");
  assert.equal(classifyTaskFailure(null, "token_expired").category, "authentication");
});

test("unknown and malformed codes fail closed to low-confidence manual review", () => {
  assert.deepEqual(classifyTaskFailure("arbitrary_provider_message_with_details"), {
    category: "unknown", confidence: "low", recommendedAction: "manual_review",
  });
  assert.deepEqual(classifyTaskFailure(null, null), {
    category: "unknown", confidence: "low", recommendedAction: "manual_review",
  });
});
