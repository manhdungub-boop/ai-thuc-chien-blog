import { describe, expect, it } from "vitest";
import { buildClaimEvidenceLedger } from "../src/claim-evidence-ledger.mjs";

const evidence = [
  { source: "OpenAI", title: "A", url: "https://openai.com/index/a", status: "source_retrieved_not_fact_checked", excerpt: "A sufficiently long excerpt about the research topic, methods, limitations and reported observations. ".repeat(2).slice(0, 180) },
  { source: "DeepMind", title: "B", url: "https://deepmind.google/blog/b", status: "source_retrieved_not_fact_checked", excerpt: "A second sufficiently long excerpt about the research topic, methods, limitations and reported observations. ".repeat(2).slice(0, 180) },
  { source: "Hugging Face", title: "C", url: "https://huggingface.co/blog/c", status: "source_retrieved_not_fact_checked", excerpt: "A third sufficiently long excerpt about the research topic, methods, limitations and reported observations. ".repeat(2).slice(0, 180) }
];
const assessment = { accepted_sources: evidence.map(({ url }) => ({ url })) };

describe("claim evidence provenance ledger", () => {
  it("maps each explicit claim to two distinct retrieved publishers without claiming verification", () => {
    const result = buildClaimEvidenceLedger([
      { id: "claim-1", text: "A factual statement requiring support.", evidence_urls: [evidence[0].url, evidence[1].url] }
    ], evidence, assessment);
    expect(result.status).toBe("all_claims_traceable_pending_human_review");
    expect(result.claims[0]).toMatchObject({
      status: "traceable_evidence_pending_human_review",
      traceable_source_count: 2,
      distinct_publisher_count: 2
    });
    expect(result.safety).toMatchObject({
      human_review_required: true,
      publication_authorized: false,
      content_published: false
    });
    expect(result.limitations.join(" ")).toContain("No semantic entailment");
  });

  it("rejects one-publisher mappings and URLs absent from the accepted assessment", () => {
    const result = buildClaimEvidenceLedger([
      { id: "claim-1", text: "Claim.", evidence_urls: [evidence[0].url, "https://unknown.example/source"] }
    ], evidence, assessment);
    expect(result.claims[0].status).toBe("needs_evidence_or_revision");
    expect(result.claims[0].reason).toBe("insufficient_distinct_publishers");
  });

  it("rejects evidence that was not retrieved or has a short excerpt", () => {
    const altered = [
      evidence[0],
      { ...evidence[1], status: "http_403" },
      { ...evidence[2], excerpt: "short" }
    ];
    const result = buildClaimEvidenceLedger([
      { id: "claim-1", text: "Claim.", evidence_urls: altered.map(item => item.url) }
    ], altered, { accepted_sources: altered.map(({ url }) => ({ url })) });
    expect(result.claims[0].traceable_source_count).toBe(1);
    expect(result.claims[0].reason).toBe("insufficient_distinct_publishers");
  });

  it("flags missing mappings, malformed text, and duplicate IDs", () => {
    const result = buildClaimEvidenceLedger([
      { id: "same", text: "First claim.", evidence_urls: [] },
      { id: "same", text: "Second claim.", evidence_urls: [] },
      { id: "claim-3", text: "", evidence_urls: [] },
      { id: "claim-4", text: "No mapping." }
    ], evidence, assessment);
    expect(result.claims.map(item => item.reason)).toEqual([
      "no_traceable_evidence",
      "invalid_or_duplicate_claim_id",
      "missing_claim_text",
      "missing_evidence_mapping"
    ]);
    expect(result.status).toBe("claim_evidence_review_incomplete");
  });

  it("bounds claims and source mappings", () => {
    const claims = Array.from({ length: 45 }, (_, index) => ({
      id: "c" + index,
      text: "Claim " + index,
      evidence_urls: [evidence[0].url, evidence[1].url, evidence[2].url, evidence[0].url, "https://extra.example/x"]
    }));
    const result = buildClaimEvidenceLedger(claims, evidence, assessment);
    expect(result.claims_received).toBe(45);
    expect(result.claims_assessed).toBe(40);
    expect(result.claim_batch_truncated).toBe(true);
    expect(result.status).toBe("claim_evidence_review_incomplete");
    expect(result.claims[0].sources).toHaveLength(0);
    expect(result.claims[0].reason).toBe("too_many_evidence_references");
  });
});
