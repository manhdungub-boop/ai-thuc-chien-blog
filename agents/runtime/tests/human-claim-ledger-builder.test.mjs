import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { buildHumanClaimReviewLedger } from "../src/human-claim-ledger-builder.mjs";

const evidence = [
  {
    source: "OpenAI",
    title: "Research overview",
    url: "https://openai.com/index/research-overview",
    status: "source_retrieved_not_fact_checked",
    excerpt: "This source excerpt describes the research system, its stated methods, scope, limitations, and reported observations in enough detail for a human reviewer to inspect."
  },
  {
    source: "DeepMind",
    title: "Research blog",
    url: "https://deepmind.google/blog/research-overview",
    status: "source_retrieved_not_fact_checked",
    excerpt: "This second source excerpt describes a related research topic, its stated methods, scope, limitations, and reported observations for independent human assessment."
  }
];
const claims = [{
  claim_id: "claim-01",
  claim: "Two named research publishers describe related bounded research methods.",
  evidence_urls: evidence.map(item => item.url)
}];

describe("human claim ledger builder", () => {
  it("binds explicit human claims to exact retrieved excerpts without making a support decision", () => {
    const result = buildHumanClaimReviewLedger(claims, evidence, { now: Date.parse("2026-11-19T00:00:00.000Z") });
    expect(result).toMatchObject({
      ok: true,
      status: "all_claims_traceable_pending_human_review",
      safety: {
        human_review_required: true,
        publication_authorized: false,
        draft_created: false,
        content_published: false
      }
    });
    expect(result.claims[0].sources).toHaveLength(2);
    expect(result.claims[0].sources[0]).toMatchObject({
      source: "OpenAI",
      host: "openai.com",
      excerpt: evidence[0].excerpt
    });
    expect(result.claims[0]).not.toHaveProperty("decision");
  });

  it("rejects a claim that references a URL without a retrieved excerpt", () => {
    const result = buildHumanClaimReviewLedger([{
      ...claims[0],
      evidence_urls: ["https://openai.com/index/research-overview", "https://example.org/missing"]
    }], evidence);
    expect(result).toMatchObject({ ok: false, reason: "claim_references_unretrieved_source" });
  });

  it("rejects duplicate publisher domains for one claim", () => {
    const sameDomain = [
      evidence[0],
      { ...evidence[1], source: "OpenAI", url: "https://openai.com/index/another-page" }
    ];
    const result = buildHumanClaimReviewLedger([{
      ...claims[0],
      evidence_urls: sameDomain.map(item => item.url)
    }], sameDomain);
    expect(result).toMatchObject({ ok: false, reason: "claim_sources_not_domain_independent" });
  });

  it("rejects unallowlisted publishers, stale retrieval statuses, and short excerpts", () => {
    const badPublisher = [{ ...evidence[0], source: "Unknown", url: "https://example.org/article" }, evidence[1]];
    const stale = [{ ...evidence[0], status: "http_404" }, evidence[1]];
    const short = [{ ...evidence[0], excerpt: "Too short" }, evidence[1]];
    expect(buildHumanClaimReviewLedger(claims, badPublisher).ok).toBe(false);
    expect(buildHumanClaimReviewLedger(claims, stale).ok).toBe(false);
    expect(buildHumanClaimReviewLedger(claims, short).ok).toBe(false);
  });

  it("rejects evidence URLs with query strings, credentials, or fragments", () => {
    const queryEvidence = [{ ...evidence[0], url: evidence[0].url + "?tracking=1" }, evidence[1]];
    const credentialEvidence = [{ ...evidence[0], url: "https://user:pass@openai.com/index/research-overview" }, evidence[1]];
    const fragmentEvidence = [{ ...evidence[0], url: evidence[0].url + "#section" }, evidence[1]];
    expect(buildHumanClaimReviewLedger(claims, queryEvidence).ok).toBe(false);
    expect(buildHumanClaimReviewLedger(claims, credentialEvidence).ok).toBe(false);
    expect(buildHumanClaimReviewLedger(claims, fragmentEvidence).ok).toBe(false);
  });

  it("rejects duplicate claim IDs and missing human claim text", () => {
    const duplicate = [claims[0], { ...claims[0] }];
    expect(buildHumanClaimReviewLedger(duplicate, evidence)).toMatchObject({
      ok: false,
      reason: "invalid_human_authored_claim"
    });
    expect(buildHumanClaimReviewLedger([{ ...claims[0], claim: " " }], evidence).ok).toBe(false);
  });
});
