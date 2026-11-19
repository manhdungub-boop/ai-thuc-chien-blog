import { describe, expect, it } from "vitest";
import { selectProvider, providerPolicy } from "../src/provider-policy.mjs";

const localAuthoringProvider = {
  id: "article-authoring-brief",
  status: "ready",
  execution_surface: "agent_runtime",
  cost_class: "no_external_execution",
  capabilities: ["content_draft"]
};

describe("runtime provider policy", () => {
  it("allows only the code-registered deterministic local authoring scaffold", () => {
    expect(selectProvider("content_draft", [localAuthoringProvider])).toEqual({
      action: "execute",
      provider: "article-authoring-brief",
      reason: "verified_free_runtime_provider_available"
    });
    expect(providerPolicy.localProviderIds).toContain("article-authoring-brief");
  });

  it("rejects an unregistered local provider even when it claims no external execution", () => {
    const result = selectProvider("content_draft", [{
      ...localAuthoringProvider,
      id: "lookalike-local-authoring"
    }]);
    expect(result.action).toBe("defer");
    expect(result.reason).toBe("local_provider_not_allowlisted");
  });

  it("rejects a registered provider when its execution surface or capability is altered", () => {
    const wrongSurface = selectProvider("content_draft", [{
      ...localAuthoringProvider,
      execution_surface: "connector"
    }]);
    expect(wrongSurface.action).toBe("defer");
    expect(wrongSurface.reason).toBe("connector_not_callable_from_agent_runtime");

    const wrongCapability = selectProvider("content_draft", [{
      ...localAuthoringProvider,
      capabilities: ["quality_review"]
    }]);
    expect(wrongCapability.action).toBe("defer");
    expect(wrongCapability.reason).toBe("no_provider_for_task");
  });

  it("never admits paid or unknown-cost providers as free fallbacks", () => {
    const paid = selectProvider("content_draft", [{
      id: "paid-model",
      status: "ready",
      execution_surface: "agent_runtime",
      cost_class: "paid",
      capabilities: ["content_draft"]
    }]);
    const unknownCost = selectProvider("content_draft", [{
      id: "unknown-cost-model",
      status: "ready",
      execution_surface: "agent_runtime",
      cost_class: "unknown",
      capabilities: ["content_draft"]
    }]);
    expect(paid.action).toBe("defer");
    expect(unknownCost.action).toBe("defer");
    expect(providerPolicy.paidFallbackAllowed).toBe(false);
    expect(providerPolicy.unknownCostAllowed).toBe(false);
  });

  it("rejects unknown task types and missing provider snapshots without execution", () => {
    expect(selectProvider("arbitrary_task", [localAuthoringProvider])).toEqual({
      action: "reject",
      provider: null,
      reason: "task_type_not_allowed"
    });
    expect(selectProvider("content_draft", null)).toEqual({
      action: "defer",
      provider: null,
      reason: "provider_snapshot_missing"
    });
  });

  it("defers external authoring inference without a trusted runtime-owned quota adapter", () => {
    const result = selectProvider("content_draft", [{
      ...localAuthoringProvider,
      id: "unverified-external-model",
      cost_class: "zero_cost_verified",
      quota: { available: true, remaining: 100, checked_at: new Date().toISOString() }
    }]);
    expect(result).toEqual({
      action: "defer",
      provider: null,
      reason: "external_provider_adapter_not_verified"
    });
    expect(providerPolicy.externalProviderIds).toEqual([]);
  });
});
