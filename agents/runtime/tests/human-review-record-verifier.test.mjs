import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { recordHumanClaimReview } from "../src/human-claim-review.mjs";
import { verifyHumanClaimReviewRecord } from "../src/human-review-record-verifier.mjs";

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
const now = Date.parse("2026-11-18T12:01:00.000Z");

async function makeRecord() {
  return recordHumanClaimReview(ledger, decisions, reviewer, { now });
}

describe("human review record verifier", () => {
  it("verifies an unchanged complete review record against its source ledger", async () => {
    const record = await makeRecord();
    const result = await verifyHumanClaimReviewRecord(record, ledger, { now });
    expect(result).toMatchObject({
      ok: true,
      status: "human_review_record_verified",
      claims_verified: 2,
      safety: { record_integrity_verified: true, reviewer_identity_authenticated: false, publication_authorized: false }
    });
  });

  it("surfaces contradictory evidence and keeps the claim out of supported status", async () => {
    const contradictoryDecisions = [
      {
        claim_id: "claim-1",
        decision: "needs_revision",
        reviewer_note: "One reviewed source directly contradicts the exact claim wording.",
        evidence_reviews: [
          { source_url: sources[0].url, decision: "supports", reviewer_note: "This excerpt supports the exact claim wording." },
          { source_url: sources[1].url, decision: "contradicts", reviewer_note: "This excerpt directly reports an incompatible result." }
        ]
      },
      decisions[1]
    ];
    const record = await recordHumanClaimReview(ledger, contradictoryDecisions, reviewer, { now });
    const result = await verifyHumanClaimReviewRecord(record, ledger, { now });
    expect(result).toMatchObject({
      ok: true,
      status: "human_review_record_verified",
      evidence_summary: {
        claims_with_contradicting_evidence: ["claim-1"],
        claims_with_insufficient_evidence: ["claim-2"],
        contradicting_evidence: [{
          claim_id: "claim-1",
          source_url: sources[1].url,
          reviewer_note: "This excerpt directly reports an incompatible result."
        }],
        insufficient_evidence: [{
          claim_id: "claim-2",
          source_url: sources[1].url,
          reviewer_note: "This passage does not provide sufficient support for the exact claim wording."
        }],
        evidence_decision_counts: { supports: 2, contradicts: 1, insufficient: 1 },
        contradiction_count: 1,
        insufficient_count: 1
      }
    });
    expect(record.claims[0].decision).toBe("needs_revision");
  });

  it("detects a changed claim after review", async () => {
    const record = await makeRecord();
    const changed = { ...ledger, claims: ledger.claims.map((claim, i) => i ? claim : ({ ...claim, claim: claim.claim + " Changed." })) };
    const result = await verifyHumanClaimReviewRecord(record, changed, { now });
    expect(result.status).toBe("claim_or_evidence_snapshot_mismatch");
  });

  it("detects a changed source excerpt after review", async () => {
    const record = await makeRecord();
    const changed = { ...ledger, claims: ledger.claims.map((claim, i) => i ? claim : ({ ...claim, sources: claim.sources.map((source, j) => j ? source : ({ ...source, excerpt: source.excerpt + " altered" })) })) };
    const result = await verifyHumanClaimReviewRecord(record, changed, { now });
    expect(result.status).toBe("claim_or_evidence_fingerprint_mismatch");
  });

  it("detects tampering with the review decision or reviewer note", async () => {
    const record = await makeRecord();
    const changedDecision = {
      ...record,
      claims: record.claims.map((claim, i) => i ? claim : ({ ...claim, decision: "unsupported" }))
    };
    const changedNote = {
      ...record,
      claims: record.claims.map((claim, i) => i ? claim : ({ ...claim, reviewer_note: "A different review explanation that was not originally recorded." }))
    };
    const decisionResult = await verifyHumanClaimReviewRecord(changedDecision, ledger, { now });
    const noteResult = await verifyHumanClaimReviewRecord(changedNote, ledger, { now });
    expect(decisionResult.status).toBe("review_decision_fingerprint_mismatch");
    expect(noteResult.status).toBe("review_decision_fingerprint_mismatch");
  });

  it("detects altered evidence URL order and missing review decisions", async () => {
    const record = await makeRecord();
    const altered = { ...record, claims: record.claims.map((claim, i) => i ? claim : ({ ...claim, evidence_urls: [...claim.evidence_urls].reverse() })) };
    const reordered = await verifyHumanClaimReviewRecord(altered, ledger, { now });
    const incomplete = await verifyHumanClaimReviewRecord({ ...record, claims: record.claims.slice(0, 1) }, ledger, { now });
    expect(reordered.status).toBe("claim_or_evidence_snapshot_mismatch");
    expect(incomplete.status).toBe("ledger_record_mismatch");
  });

  it("rejects a record that claims publication or has invalid reviewer metadata", async () => {
    const record = await makeRecord();
    const unsafe = { ...record, safety: { ...record.safety, content_published: true } };
    const invalid = await verifyHumanClaimReviewRecord(unsafe, ledger, { now });
    const badReviewer = await verifyHumanClaimReviewRecord({ ...record, reviewer_ref: "x" }, ledger, { now });
    expect(invalid.status).toBe("invalid_review_record");
    expect(badReviewer.status).toBe("invalid_review_metadata");
  });

  it("authenticates reviewer identity only when a server-verified session matches the record reference", async () => {
    const record = await makeRecord();
    const matching = await verifyHumanClaimReviewRecord(record, ledger, {
      now,
      authenticatedReviewer: { authenticated: true, reviewer_ref: record.reviewer_ref }
    });
    const mismatched = await verifyHumanClaimReviewRecord(record, ledger, {
      now,
      authenticatedReviewer: { authenticated: true, reviewer_ref: "google:another-subject" }
    });
    expect(matching.safety.reviewer_identity_authenticated).toBe(true);
    expect(mismatched.safety.reviewer_identity_authenticated).toBe(false);
  });

});
