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
