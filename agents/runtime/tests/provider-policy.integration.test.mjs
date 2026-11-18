import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { selectProvider, providerPolicy } from "../src/provider-policy.mjs";

const runtimeSource = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");

const localAuthoringProvider = {
  id: "article-authoring-brief",
  status: "ready",
  execution_surface: "agent_runtime",
  cost_class: "no_external_execution",
  capabilities: ["content_draft"]
};

describe("runtime provider policy integration", () => {
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

  it("checks provider policy before building or persisting an authoring brief", () => {
    const policyCall = runtimeSource.indexOf('selectProvider("content_draft"');
    const policyBlock = runtimeSource.indexOf('authoringPolicy.action !== "execute"', policyCall);
    const briefBuilder = runtimeSource.indexOf("buildArticleAuthoringBrief({", policyCall);
    const persistence = runtimeSource.indexOf("draftStore.createDraft(draftTaskId, brief.draft)", policyCall);

    expect(policyCall).toBeGreaterThan(-1);
    expect(policyBlock).toBeGreaterThan(policyCall);
    expect(briefBuilder).toBeGreaterThan(policyBlock);
    expect(persistence).toBeGreaterThan(briefBuilder);
    expect(runtimeSource).toContain('status: "authoring_provider_deferred"');
    expect(runtimeSource).toContain("publication_authorized: false");
  });

  it("keeps AI inference and public publishing disabled", () => {
    expect(runtimeSource).toContain("ai_inference_enabled: false");
    expect(runtimeSource).toContain("website_publication_enabled: false");
    expect(runtimeSource).toContain("facebook_publication_enabled: false");
  });
});
