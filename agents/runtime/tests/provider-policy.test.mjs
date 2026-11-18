import test from "node:test";
import assert from "node:assert/strict";
import { selectProvider, providerPolicy } from "../src/provider-policy.mjs";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const fresh = "2026-11-18T11:55:00.000Z";
const provider = (overrides = {}) => ({
  id: "cloudflare-workers-ai",
  status: "ready",
  execution_surface: "agent_runtime",
  cost_class: "zero_cost_verified",
  capabilities: ["content_research"],
  priority: 10,
  quota: { available: true, remaining: 1000, checked_at: fresh },
  ...overrides
});

test("selects the highest-priority provider with fresh positive free quota", () => {
  const result = selectProvider("content_research", [
    provider({ id: "fallback", priority: 20 }),
    provider({ id: "primary", priority: 1 })
  ], NOW);
  assert.deepEqual(result, {
    action: "execute",
    provider: "primary",
    reason: "verified_free_runtime_provider_available"
  });
});

test("fails over when the preferred provider has exhausted its free quota", () => {
  const result = selectProvider("content_research", [
    provider({ id: "primary", quota: { available: false, remaining: 0, checked_at: fresh } }),
    provider({ id: "fallback", priority: 20 })
  ], NOW);
  assert.equal(result.provider, "fallback");
  assert.equal(result.action, "execute");
});

test("does not select a provider when quota evidence is stale", () => {
  const result = selectProvider("content_research", [
    provider({ quota: { available: true, remaining: 10, checked_at: "2026-11-18T11:00:00.000Z" } })
  ], NOW);
  assert.equal(result.action, "defer");
  assert.equal(result.reason, "quota_evidence_stale");
});

test("never uses paid, unknown-cost, or unverified providers as fallback", () => {
  for (const cost_class of ["paid", "cost_unverified", "unknown"]) {
    const result = selectProvider("content_research", [provider({ cost_class })], NOW);
    assert.equal(result.action, "defer");
    assert.equal(result.provider, null);
  }
});

test("does not mistake a ChatGPT-connected plugin for a runtime-callable adapter", () => {
  const result = selectProvider("media_image", [
    provider({
      id: "openart-chatgpt-connector",
      execution_surface: "chatgpt_connector",
      capabilities: ["media_image"]
    })
  ], NOW);
  assert.equal(result.action, "defer");
  assert.equal(result.reason, "connector_not_callable_from_agent_runtime");
});

test("defers when all verified free quotas are exhausted", () => {
  const result = selectProvider("content_research", [
    provider({ quota: { available: false, remaining: 0, checked_at: fresh } })
  ], NOW);
  assert.equal(result.action, "defer");
  assert.equal(result.reason, "all_verified_free_quotas_exhausted");
});

test("rejects task types outside the explicit allowlist", () => {
  const result = selectProvider("send_spam", [provider()], NOW);
  assert.deepEqual(result, { action: "reject", provider: null, reason: "task_type_not_allowed" });
});

test("policy never permits paid or unknown-cost fallback", () => {
  assert.equal(providerPolicy.failClosed, true);
  assert.equal(providerPolicy.paidFallbackAllowed, false);
  assert.equal(providerPolicy.unknownCostAllowed, false);
});
