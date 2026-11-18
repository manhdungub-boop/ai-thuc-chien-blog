import { reviewArticleDraft } from "./article-quality-gate.mjs";
import { verifyHumanClaimReviewRecord } from "./human-review-record-verifier.mjs";

/**
 * Evaluate whether an article draft is traceable to claims explicitly reviewed
 * as supported. This is a release-readiness pre-check only; it never publishes.
 */
export async function assessArticleEvidenceReadiness({
  draft,
  ledger,
  reviewRecord,
  now = Date.now()
} = {}) {
  const reviewVerification = await verifyHumanClaimReviewRecord(reviewRecord, ledger, { now });
  if (!reviewVerification.ok) {
    return {
      ok: false,
      status: "human_review_record_not_verified",
      review_status: reviewVerification.status,
      publication_authorized: false,
      content_published: false
    };
  }

  if (!draft || typeof draft !== "object" || Array.isArray(draft) ||
      !Array.isArray(draft.claims) || draft.claims.length < 1 ||
      draft.claims.length > 40) {
    return {
      ok: false,
      status: "article_claim_manifest_invalid",
      issues: [{ code: "claim_manifest_required", detail: "Provide 1–40 explicit factual claims with exact reviewed claim IDs, text, and evidence URLs." }],
      publication_authorized: false,
      content_published: false
    };
  }

  const ledgerById = new Map(ledger.claims.map(claim => [claim.claim_id, claim]));
  const reviewById = new Map(reviewRecord.claims.map(claim => [claim.claim_id, claim]));
  const seen = new Set();
  const claimIssues = [];

  for (const item of draft.claims) {
    const id = item?.claim_id;
    if (typeof id !== "string" || seen.has(id)) {
      claimIssues.push({ code: "invalid_or_duplicate_claim_id", claim_id: typeof id === "string" ? id : null });
      continue;
    }
    seen.add(id);
    const sourceClaim = ledgerById.get(id);
    const reviewed = reviewById.get(id);
    if (!sourceClaim || !reviewed) {
      claimIssues.push({ code: "claim_not_in_reviewed_ledger", claim_id: id });
      continue;
    }
    if (item.claim !== sourceClaim.claim || item.claim !== reviewed.claim) {
      claimIssues.push({ code: "claim_text_mismatch", claim_id: id });
      continue;
    }
    if (reviewed.decision !== "supported") {
      claimIssues.push({ code: "claim_not_reviewed_as_supported", claim_id: id, decision: reviewed.decision });
      continue;
    }
    const expectedUrls = reviewed.evidence_urls;
    if (!Array.isArray(item.evidence_urls) ||
        item.evidence_urls.length !== expectedUrls.length ||
        item.evidence_urls.some((url, index) => url !== expectedUrls[index])) {
      claimIssues.push({ code: "claim_evidence_mapping_mismatch", claim_id: id });
    }
  }

  if (claimIssues.length) {
    return {
      ok: false,
      status: "article_claim_evidence_not_ready",
      claims_assessed: draft.claims.length,
      issues: claimIssues,
      review_status: reviewVerification.status,
      publication_authorized: false,
      content_published: false
    };
  }

  const articleQuality = reviewArticleDraft(draft);
  if (!articleQuality.ok) {
    return {
      ok: false,
      status: "article_quality_gate_failed",
      claims_assessed: draft.claims.length,
      article_quality: articleQuality,
      review_status: reviewVerification.status,
      publication_authorized: false,
      content_published: false
    };
  }

  return {
    ok: true,
    status: "eligible_for_owner_release_review",
    claims_assessed: draft.claims.length,
    article_quality: articleQuality,
    review_status: reviewVerification.status,
    limitations: [
      "Only the explicitly supplied claim manifest is checked; this does not discover omitted factual claims in the article body.",
      "A supported decision is a recorded human judgment, not an independent fact-check or proof of truth.",
      "This gate does not assess originality, source authority, licensing, copyright clearance, or legal compliance.",
      "Owner release approval and separate deployment/publication gates remain mandatory."
    ],
    publication_authorized: false,
    content_published: false,
    social_post_published: false
  };
}
