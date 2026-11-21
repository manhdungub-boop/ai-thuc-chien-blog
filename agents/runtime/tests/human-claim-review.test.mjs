import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { recordHumanClaimReview } from "../src/human-claim-review.mjs";

const sources = [
  { source: "OpenAI News", title: "A", url: "https://openai.com/index/a", host: "openai.com", excerpt: "A sufficiently long excerpt about the research topic, methods, limitations and reported observations. ".repeat(2).slice(0, 180) },
  { source: "Google DeepMind", title: "B", url: "https://deepmind.google/blog/b", host: "deepmind.google", excerpt: "A second sufficiently long excerpt about the research topic, methods, limitations and reported observations. ".repeat(2).slice(0, 180) }
];
const ledger = {
  status: "all_claims_traceable_pending_human_review",
  safety: { human_review_required: true, publication_authorized: false },
  claims: [
    { claim_id: "claim-1", claim: "A factual statement requiring human review.", status: "traceable_evidence_pending_human_review", sources },
    { claim_id: "claim-2", claim: "A second factual statement requiring human review.", status: "traceable_evidence_pending_human_review", sources }
  ]
};
const reviewer = { reviewer_ref: "editor.dung", reviewed_at: "2026-11-18T12:00:00.000Z" };
const evidenceReviews = [
  { source_url: sources[0].url, decision: "supports", reviewer_note: "This passage directly supports the exact claim statement." },
  { source_url: sources[1].url, decision: "supports", reviewer_note: "This second passage independently supports the exact claim statement." }
];
const decisions = [
  { claim_id: "claim-1", decision: "supported", reviewer_note: "Both excerpts directly address the exact claim wording.", evidence_reviews: evidenceReviews },
  { claim_id: "claim-2", decision: "needs_revision", reviewer_note: "The second source is relevant but does not support this wording.", evidence_reviews: [evidenceReviews[0], { ...evidenceReviews[1], decision: "insufficient", reviewer_note: "This passage does not provide sufficient support for the exact claim wording." }] }
];

describe("human claim review record", () => {
  it("records a complete reviewer decision set with SHA-256 claim snapshots", async () => {
    const result = await recordHumanClaimReview(ledger, decisions, reviewer, { now: Date.parse("2026-11-18T12:01:00.000Z") });
    expect(result).toMatchObject({
      ok: true,
      status: "human_review_recorded_pending_release_gates",
      claims_received: 2,
      claims_reviewed: 2,
      safety: { human_review_recorded: true, publication_authorized: false, content_published: false }
    });
    expect(result.claims[0].decision).toBe("supported");
    expect(result.claims[1].decision).toBe("needs_revision");
    expect(result.claims[0].claim_fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.claims[0].evidence_urls).toHaveLength(2);
    expect(result.limitations.join(" ")).toContain("does not establish truth");
  });

  it("rejects partial, duplicate, unknown, or unsupported decisions atomically", async () => {
    const partial = await recordHumanClaimReview(ledger, decisions.slice(0, 1), reviewer);
    const duplicate = await recordHumanClaimReview(ledger, [decisions[0], decisions[0]], reviewer);
    const unknown = await recordHumanClaimReview(ledger, [decisions[0], { ...decisions[1], claim_id: "missing" }], reviewer);
    const invalid = await recordHumanClaimReview(ledger, [decisions[0], { ...decisions[1], decision: "publish" }], reviewer);
    expect(partial.status).toBe("review_decisions_incomplete");
    expect(duplicate.status).toBe("invalid_review_decision");
    expect(unknown.status).toBe("invalid_review_decision");
    expect(invalid.status).toBe("invalid_review_decision");
  });

  it("rejects missing or malformed reviewer identity and timestamps", async () => {
    const noReviewer = await recordHumanClaimReview(ledger, decisions, { reviewer_ref: "x", reviewed_at: reviewer.reviewed_at });
    const future = await recordHumanClaimReview(ledger, decisions, { ...reviewer, reviewed_at: "2026-11-19T00:00:00.000Z" }, { now: Date.parse("2026-11-18T12:00:00.000Z") });
    expect(noReviewer.status).toBe("invalid_reviewer_metadata");
    expect(future.status).toBe("invalid_reviewer_metadata");
  });

  it("rejects ledgers that are not explicitly pending human review", async () => {
    const unauthorized = { ...ledger, status: "all_claims_traceable_pending_human_review", safety: { ...ledger.safety, publication_authorized: true } };
    const reviewed = await recordHumanClaimReview(unauthorized, decisions, reviewer);
    const alreadyApproved = { ...ledger, status: "all_claims_traceable_pending_human_review", claims: ledger.claims.map(claim => ({ ...claim, status: "approved" })) };
    const invalidClaim = await recordHumanClaimReview(alreadyApproved, decisions, reviewer);
    expect(reviewed.status).toBe("invalid_review_ledger");
    expect(invalidClaim.status).toBe("invalid_review_ledger_claim");
  });

  it("rejects altered evidence snapshots and insufficient publisher diversity", async () => {
    const altered = { ...ledger, claims: ledger.claims.map((claim, index) => index ? claim : ({ ...claim, sources: [sources[0], { ...sources[1], host: "openai.com" }] })) };
    const result = await recordHumanClaimReview(altered, decisions, reviewer);
    expect(result.status).toBe("invalid_review_ledger_claim");
  });

  it("requires a separate, exact-URL decision and note for every evidence source", async () => {
    const missing = await recordHumanClaimReview(ledger, [
      { ...decisions[0], evidence_reviews: [evidenceReviews[0]] },
      decisions[1]
    ], reviewer);
    const mismatched = await recordHumanClaimReview(ledger, [
      { ...decisions[0], evidence_reviews: [{ ...evidenceReviews[0], source_url: "https://forged.example/source" }, evidenceReviews[1]] },
      decisions[1]
    ], reviewer);
    const falselySupported = await recordHumanClaimReview(ledger, [
      { ...decisions[0], evidence_reviews: [evidenceReviews[0], { ...evidenceReviews[1], decision: "insufficient" }] },
      decisions[1]
    ], reviewer);
    expect(missing.status).toBe("evidence_reviews_incomplete_or_inconsistent");
    expect(mismatched.status).toBe("evidence_reviews_incomplete_or_inconsistent");
    expect(falselySupported.status).toBe("evidence_reviews_incomplete_or_inconsistent");
  });

  it("requires a meaningful reviewer note for every claim", async () => {
    const result = await recordHumanClaimReview(ledger, [decisions[0], { ...decisions[1], reviewer_note: "ok" }], reviewer);
    expect(result.status).toBe("invalid_review_decision");
  });
});
