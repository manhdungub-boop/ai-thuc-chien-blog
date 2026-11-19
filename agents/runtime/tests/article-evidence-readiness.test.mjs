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
  evidence_urls: sources.map(source => source.url),
  citation_indices: [1, 2]
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
      ledger.claims[0].claim + " [1] [2] [3]. " + words,
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
  it("blocks release eligibility when the reviewer identity is not authenticated", async () => {
    const reviewRecord = await makeReview();
    const result = await assessArticleEvidenceReadiness({ draft: makeDraft(), ledger, reviewRecord, now });
    expect(result).toMatchObject({
      ok: false,
      status: "human_reviewer_identity_not_authenticated",
      reviewer_identity_authenticated: false,
      review_status: "human_review_record_verified",
      publication_authorized: false,
      content_published: false,
      social_post_published: false
    });
  });


  it("binds each reviewed evidence URL to the matching source-list citation index", async () => {
    const reviewRecord = await makeReview();
    const wrongIndex = makeDraft([{
      ...makeDraft().claims[0],
      citation_indices: [2, 1]
    }]);
    const missingMarker = makeDraft();
    missingMarker.body_markdown = missingMarker.body_markdown.replace("[2]", "[3]");
    const wrongIndexResult = await assessArticleEvidenceReadiness({ draft: wrongIndex, ledger, reviewRecord, now });
    const missingMarkerResult = await assessArticleEvidenceReadiness({ draft: missingMarker, ledger, reviewRecord, now });
    expect(wrongIndexResult.issues[0].code).toBe("claim_citation_source_order_mismatch");
    expect(missingMarkerResult.issues[0].code).toBe("claim_inline_citation_missing_from_body");
  });

  it("requires every reviewed claim to appear in the article body", async () => {
    const reviewRecord = await makeReview();
    const missing = makeDraft();
    missing.body_markdown = missing.body_markdown.replace(ledger.claims[0].claim, "Một nội dung khác không chứa tuyên bố đã duyệt.");
    const result = await assessArticleEvidenceReadiness({
      draft: missing,
      ledger,
      reviewRecord,
      authenticatedReviewer: { authenticated: true, reviewer_ref: reviewRecord.reviewer_ref },
      now
    });
    expect(result).toMatchObject({
      ok: false,
      status: "article_claim_evidence_not_ready",
      publication_authorized: false
    });
    expect(result.issues).toContainEqual({
      code: "reviewed_claim_missing_from_article_body",
      claim_id: "claim-1"
    });
  });

  it("blocks numeric factual sentences that are absent from the reviewed claim manifest", async () => {
    const reviewRecord = await makeReview();
    const draft = makeDraft();
    draft.body_markdown = draft.body_markdown.replace(
      "## Quy trình",
      "## Quy trình\n\nTỷ lệ xử lý thành công đạt 95% trong năm 2026. [1]\n"
    );
    const result = await assessArticleEvidenceReadiness({
      draft,
      ledger,
      reviewRecord,
      authenticatedReviewer: { authenticated: true, reviewer_ref: reviewRecord.reviewer_ref },
      now
    });
    expect(result.status).toBe("article_claim_evidence_not_ready");
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "unreviewed_quantitative_claim_candidate",
      excerpt: "Tỷ lệ xử lý thành công đạt 95% trong năm 2026."
    }));
    expect(result.publication_authorized).toBe(false);
  });

  it("flags an added numeric assertion appended to an otherwise reviewed sentence", async () => {
    const reviewRecord = await makeReview();
    const draft = makeDraft();
    draft.body_markdown = draft.body_markdown.replace(
      ledger.claims[0].claim + " [1] [2] [3].",
      ledger.claims[0].claim + " và cải thiện kết quả thêm 95% [1] [2] [3]."
    );
    const result = await assessArticleEvidenceReadiness({
      draft,
      ledger,
      reviewRecord,
      authenticatedReviewer: { authenticated: true, reviewer_ref: reviewRecord.reviewer_ref },
      now
    });
    expect(result.status).toBe("article_claim_evidence_not_ready");
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "unreviewed_quantitative_claim_candidate",
      excerpt: expect.stringContaining("95%")
    }));
    expect(result.publication_authorized).toBe(false);
  });

  it("does not treat inline numeric citation markers as quantitative claim candidates", async () => {
    const reviewRecord = await makeReview();
    const result = await assessArticleEvidenceReadiness({
      draft: makeDraft(),
      ledger,
      reviewRecord,
      authenticatedReviewer: { authenticated: true, reviewer_ref: reviewRecord.reviewer_ref },
      now
    });
    expect(result.status).toBe("eligible_for_owner_release_review");
    expect(result.quantitative_claim_scan).toEqual({
      status: "heuristic_scan_completed",
      unreviewed_candidates: 0
    });
  });

  it("does not count reviewed claim wording found only inside fenced code", async () => {
    const reviewRecord = await makeReview();
    const codeOnly = makeDraft();
    codeOnly.body_markdown = codeOnly.body_markdown.replace(
      ledger.claims[0].claim,
      "```text\n" + ledger.claims[0].claim + "\n```"
    );
    const result = await assessArticleEvidenceReadiness({
      draft: codeOnly,
      ledger,
      reviewRecord,
      authenticatedReviewer: { authenticated: true, reviewer_ref: reviewRecord.reviewer_ref },
      now
    });
    expect(result.status).toBe("article_claim_evidence_not_ready");
    expect(result.issues).toContainEqual({
      code: "reviewed_claim_missing_from_article_body",
      claim_id: "claim-1"
    });
  });

  it("rejects absent or duplicate claim citation indices", async () => {
    const reviewRecord = await makeReview();
    const absent = makeDraft([{ ...makeDraft().claims[0], citation_indices: undefined }]);
    const duplicate = makeDraft([{ ...makeDraft().claims[0], citation_indices: [1, 1] }]);
    const absentResult = await assessArticleEvidenceReadiness({ draft: absent, ledger, reviewRecord, now });
    const duplicateResult = await assessArticleEvidenceReadiness({ draft: duplicate, ledger, reviewRecord, now });
    expect(absentResult.issues[0].code).toBe("claim_inline_citations_invalid");
    expect(duplicateResult.issues[0].code).toBe("claim_inline_citations_invalid");
  });
  it("surfaces contradictory evidence and blocks article readiness", async () => {
    const reviewRecord = await recordHumanClaimReview(ledger, [{
      ...decisions[0],
      decision: "needs_revision",
      evidence_reviews: [
        { source_url: sources[0].url, decision: "supports", reviewer_note: "This excerpt supports the exact claim wording." },
        { source_url: sources[1].url, decision: "contradicts", reviewer_note: "This excerpt reports an incompatible result." }
      ]
    }], reviewer, { now });
    const result = await assessArticleEvidenceReadiness({
      draft: makeDraft(),
      ledger,
      reviewRecord,
      authenticatedReviewer: { authenticated: true, reviewer_ref: reviewRecord.reviewer_ref },
      now
    });
    expect(result.status).toBe("article_claim_evidence_not_ready");
    expect(result.issues).toContainEqual({
      code: "claim_not_reviewed_as_supported",
      claim_id: "claim-1",
      decision: "needs_revision"
    });
    expect(result.evidence_summary).toMatchObject({
      claims_with_contradicting_evidence: ["claim-1"],
      evidence_decision_counts: { supports: 1, contradicts: 1, insufficient: 0 },
      contradiction_count: 1
    });
    expect(result.publication_authorized).toBe(false);
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

  it("marks evidence review eligible for owner review only when the verified Google principal matches", async () => {
    const reviewRecord = await makeReview();
    const result = await assessArticleEvidenceReadiness({
      draft: makeDraft(),
      ledger,
      reviewRecord,
      authenticatedReviewer: { authenticated: true, reviewer_ref: reviewRecord.reviewer_ref },
      now
    });
    expect(result).toMatchObject({
      ok: true,
      status: "eligible_for_owner_release_review",
      review_status: "human_review_record_verified",
      publication_authorized: false,
      content_published: false,
      social_post_published: false
    });
  });

});
