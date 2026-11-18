import { describe, expect, it } from "vitest";
import { recordHumanClaimReview } from "../src/human-claim-review.mjs";
import { assessArticleEvidenceReadiness } from "../src/article-evidence-readiness.mjs";

const sources = [
  { source: "OpenAI", title: "A", url: "https://openai.com/index/a", host: "openai.com", excerpt: "A sufficiently long excerpt about the research topic, methods, limitations and reported observations. ".repeat(2).slice(0, 180) },
  { source: "DeepMind", title: "B", url: "https://deepmind.google/blog/b", host: "deepmind.google", excerpt: "A second sufficiently long excerpt about the research topic, methods, limitations and reported observations. ".repeat(2).slice(0, 180) }
];
const ledger = {
  status: "all_claims_traceable_pending_human_review",
  safety: { human_review_required: true, publication_authorized: false },
  claims: [{
    claim_id: "claim-1",
    claim: "The system supports bounded research discovery.",
    status: "traceable_evidence_pending_human_review",
    sources
  }]
};
const reviewer = { reviewer_ref: "editor.dung", reviewed_at: "2026-11-18T12:00:00.000Z" };
const decisions = [{
  claim_id: "claim-1",
  decision: "supported",
  reviewer_note: "Both excerpts directly address the exact claim wording."
}];
const now = Date.parse("2026-11-18T12:01:00.000Z");

function makeDraft(claims = [{
  claim_id: "claim-1",
  claim: ledger.claims[0].claim,
  evidence_urls: sources.map(source => source.url)
}]) {
  const words = Array.from({ length: 620 }, () => "nghiên-cứu").join(" ");
  return {
    title: "Hướng dẫn nghiên cứu AI có kiểm soát và an toàn",
    slug: "huong-dan-nghien-cuu-ai-co-kiem-soat",
    meta_description: "Hướng dẫn thực hành nghiên cứu AI có kiểm soát, kiểm tra nguồn, đánh giá bằng chứng và bảo đảm an toàn trước khi xuất bản nội dung.",
    author: "DUNG - AI",
    language: "vi",
    body_markdown: [
      "## Tổng quan",
      "Nội dung [1] [2] [3]. " + words,
      "## Quy trình",
      "Nội dung chi tiết.",
      "## Kiểm tra",
      "Nội dung chi tiết.",
      "## Giới hạn",
      "Nội dung chi tiết."
    ].join("\n\n"),
    sources: [
      { title: "A", publisher: "OpenAI", url: "https://openai.com/index/a", accessed_at: "2026-11-18" },
      { title: "B", publisher: "DeepMind", url: "https://deepmind.google/blog/b", accessed_at: "2026-11-18" },
      { title: "C", publisher: "Hugging Face", url: "https://huggingface.co/blog/c", accessed_at: "2026-11-18" }
    ],
    copyright_notice: "© DUNG - AI. Nội dung có trích dẫn nguồn.",
    claims
  };
}

async function makeReview(decision = "supported") {
  return recordHumanClaimReview(ledger, [{ ...decisions[0], decision }], reviewer, { now });
}

describe("article evidence readiness", () => {
  it("allows an exact article claim mapped to a verified supported review, without authorizing publication", async () => {
    const reviewRecord = await makeReview();
    const result = await assessArticleEvidenceReadiness({ draft: makeDraft(), ledger, reviewRecord, now });
    expect(result).toMatchObject({
      ok: true,
      status: "eligible_for_owner_release_review",
      publication_authorized: false,
      content_published: false,
      social_post_published: false
    });
  });

  it("rejects claims that were not reviewed as supported", async () => {
    const reviewRecord = await makeReview("needs_revision");
    const result = await assessArticleEvidenceReadiness({ draft: makeDraft(), ledger, reviewRecord, now });
    expect(result.status).toBe("article_claim_evidence_not_ready");
    expect(result.issues[0].code).toBe("claim_not_reviewed_as_supported");
  });

  it("rejects claim text or evidence mappings that differ from the reviewed snapshot", async () => {
    const reviewRecord = await makeReview();
    const changedClaim = makeDraft([{ ...makeDraft().claims[0], claim: "Different wording." }]);
    const changedEvidence = makeDraft([{ ...makeDraft().claims[0], evidence_urls: ["https://openai.com/index/a"] }]);
    const claimResult = await assessArticleEvidenceReadiness({ draft: changedClaim, ledger, reviewRecord, now });
    const evidenceResult = await assessArticleEvidenceReadiness({ draft: changedEvidence, ledger, reviewRecord, now });
    expect(claimResult.issues[0].code).toBe("claim_text_mismatch");
    expect(evidenceResult.issues[0].code).toBe("claim_evidence_mapping_mismatch");
  });

  it("requires reviewed evidence URLs to appear in the article reference list", async () => {
    const reviewRecord = await makeReview();
    const draft = { ...makeDraft(), sources: makeDraft().sources.slice(1) };
    const result = await assessArticleEvidenceReadiness({ draft, ledger, reviewRecord, now });
    expect(result.status).toBe("article_claim_evidence_not_ready");
    expect(result.issues[0].code).toBe("reviewed_evidence_missing_from_article_sources");
  });

  it("rejects invalid review records and incomplete article claim manifests", async () => {
    const reviewRecord = await makeReview();
    const alteredRecord = { ...reviewRecord, claims: reviewRecord.claims.map(claim => ({ ...claim, reviewer_note: "Tampered reviewer note." })) };
    const badReview = await assessArticleEvidenceReadiness({ draft: makeDraft(), ledger, reviewRecord: alteredRecord, now });
    const missingManifest = await assessArticleEvidenceReadiness({ draft: { ...makeDraft(), claims: [] }, ledger, reviewRecord, now });
    expect(badReview.status).toBe("human_review_record_not_verified");
    expect(missingManifest.status).toBe("article_claim_manifest_invalid");
  });

  it("still requires the independent article structure and safety quality gate", async () => {
    const reviewRecord = await makeReview();
    const draft = { ...makeDraft(), title: "Too short" };
    const result = await assessArticleEvidenceReadiness({ draft, ledger, reviewRecord, now });
    expect(result.status).toBe("article_quality_gate_failed");
    expect(result.publication_authorized).toBe(false);
  });
});
