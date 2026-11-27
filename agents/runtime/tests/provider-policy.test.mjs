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

test("does not trust a provider-supplied fresh positive quota without a runtime-owned adapter", () => {
  const result = selectProvider("content_research", [provider()], NOW);
  assert.deepEqual(result, {
    action: "defer",
    provider: null,
    reason: "external_provider_adapter_not_verified"
  });
});

test("does not fail over between external providers that lack trusted quota adapters", () => {
  const result = selectProvider("content_research", [
    provider({ id: "primary", priority: 1, quota: { available: false, remaining: 0, checked_at: fresh } }),
    provider({ id: "fallback", priority: 20 })
  ], NOW);
  assert.equal(result.action, "defer");
  assert.equal(result.provider, null);
  assert.equal(result.reason, "external_provider_adapter_not_verified");
});

test("does not trust stale quota snapshots supplied by an unverified provider", () => {
  const result = selectProvider("content_research", [
    provider({ quota: { available: true, remaining: 10, checked_at: "2026-11-18T11:00:00.000Z" } })
  ], NOW);
  assert.equal(result.action, "defer");
  assert.equal(result.reason, "external_provider_adapter_not_verified");
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

test("rejects task types outside the explicit allowlist", () => {
  const result = selectProvider("send_spam", [provider()], NOW);
  assert.deepEqual(result, { action: "reject", provider: null, reason: "task_type_not_allowed" });
});

test("policy never permits paid or unknown-cost fallback and has no external adapter enabled", () => {
  assert.equal(providerPolicy.failClosed, true);
  assert.equal(providerPolicy.paidFallbackAllowed, false);
  assert.equal(providerPolicy.unknownCostAllowed, false);
  assert.deepEqual(providerPolicy.externalProviderIds, []);
});

test("allows only the registered deterministic article quality gate without external quota", () => {
  const result = selectProvider("quality_review", [
    provider({
      id: "article-quality-gate",
      cost_class: "no_external_execution",
      capabilities: ["quality_review"],
      quota: undefined
    })
  ], NOW);
  assert.equal(result.action, "execute");
  assert.equal(result.provider, "article-quality-gate");
});

test("rejects arbitrary providers that self-declare no external execution", () => {
  const result = selectProvider("quality_review", [
    provider({
      id: "unregistered-local-validator",
      cost_class: "no_external_execution",
      capabilities: ["quality_review"],
      quota: undefined
    })
  ], NOW);
  assert.equal(result.action, "defer");
  assert.equal(result.provider, null);
  assert.equal(result.reason, "local_provider_not_allowlisted");
});
