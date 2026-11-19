import { classifyResearchPublisher } from "./research-publisher-policy.mjs";

const MAX_CLAIMS = 40;
const MIN_NOTE_CHARS = 20;
const MAX_NOTE_CHARS = 500;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const DECISIONS = new Set(["supported", "unsupported", "needs_revision"]);

function validReviewerRef(value) {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,63}$/.test(value);
}

function validIsoTimestamp(value, now) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value &&
    parsed <= now + MAX_FUTURE_SKEW_MS;
}

async function fingerprintClaim(claim) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") {
    throw new Error("sha256_unavailable");
  }
  const snapshot = {
    claim_id: claim.claim_id,
    claim: claim.claim,
    sources: claim.sources.map(source => ({
      source: source.source,
      title: source.title,
      url: source.url,
      host: source.host,
      excerpt: source.excerpt
    }))
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprintReviewDecision(reviewedClaim) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") {
    throw new Error("sha256_unavailable");
  }
  const snapshot = {
    claim_id: reviewedClaim.claim_id,
    claim: reviewedClaim.claim,
    decision: reviewedClaim.decision,
    reviewer_note: reviewedClaim.reviewer_note,
    reviewer_ref: reviewedClaim.reviewer_ref,
    reviewed_at: reviewedClaim.reviewed_at,
    claim_fingerprint_sha256: reviewedClaim.claim_fingerprint_sha256,
    evidence_urls: reviewedClaim.evidence_urls,
    evidence_reviews: reviewedClaim.evidence_reviews
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify that a human-review record still matches the exact current ledger.
 * This detects changed claim/evidence snapshots; it does not authenticate the
 * reviewer or establish the truth of a review decision.
 */
export async function verifyHumanClaimReviewRecord(record, ledger, {
  now = Date.now(),
  authenticatedReviewer = null
} = {}) {
  if (record?.ok !== true ||
      record?.status !== "human_review_recorded_pending_release_gates" ||
      record?.safety?.human_review_recorded !== true ||
      record?.safety?.publication_authorized !== false ||
      record?.safety?.draft_created !== false ||
      record?.safety?.catalog_modified !== false ||
      record?.safety?.content_published !== false ||
      record?.safety?.social_post_published !== false) {
    return { ok: false, status: "invalid_review_record" };
  }

  if (ledger?.status !== "all_claims_traceable_pending_human_review" ||
      ledger?.safety?.human_review_required !== true ||
      ledger?.safety?.publication_authorized !== false ||
      !Array.isArray(ledger.claims) ||
      ledger.claims.length < 1 ||
      ledger.claims.length > MAX_CLAIMS ||
      record.claims_received !== ledger.claims.length ||
      record.claims_reviewed !== ledger.claims.length ||
      !Array.isArray(record.claims) ||
      record.claims.length !== ledger.claims.length) {
    return { ok: false, status: "ledger_record_mismatch" };
  }

  if (!validReviewerRef(record.reviewer_ref) ||
      !validIsoTimestamp(record.reviewed_at, now)) {
    return { ok: false, status: "invalid_review_metadata" };
  }

  const recordById = new Map();
  for (const reviewed of record.claims) {
    if (typeof reviewed?.claim_id !== "string" ||
        recordById.has(reviewed.claim_id) ||
        reviewed.reviewer_ref !== record.reviewer_ref ||
        reviewed.reviewed_at !== record.reviewed_at ||
        !DECISIONS.has(reviewed.decision) ||
        typeof reviewed.reviewer_note !== "string" ||
        reviewed.reviewer_note.length < MIN_NOTE_CHARS ||
        reviewed.reviewer_note.length > MAX_NOTE_CHARS ||
        !Array.isArray(reviewed.evidence_urls) ||
        !Array.isArray(reviewed.evidence_reviews)) {
      return { ok: false, status: "invalid_reviewed_claim" };
    }
    recordById.set(reviewed.claim_id, reviewed);
  }

  for (const claim of ledger.claims) {
    const reviewed = recordById.get(claim?.claim_id);
    if (!reviewed ||
        claim.status !== "traceable_evidence_pending_human_review" ||
        typeof claim.claim !== "string" ||
        reviewed.claim !== claim.claim ||
        !Array.isArray(claim.sources) ||
        reviewed.evidence_urls.length !== claim.sources.length ||
        reviewed.evidence_urls.some((url, index) => url !== claim.sources[index]?.url) ||
        reviewed.evidence_reviews.length !== claim.sources.length ||
        reviewed.evidence_reviews.some((review, index) =>
          review?.source_url !== claim.sources[index]?.url ||
          !["supports", "contradicts", "insufficient"].includes(review?.decision) ||
          typeof review?.reviewer_note !== "string" ||
          review.reviewer_note.trim().length < MIN_NOTE_CHARS ||
          review.reviewer_note.length > MAX_NOTE_CHARS
        ) || (reviewed.decision === "supported" && reviewed.evidence_reviews.some(review => review.decision !== "supports"))) {
      return { ok: false, status: "claim_or_evidence_snapshot_mismatch" };
    }

    if (claim.sources.some(source => {
      try {
        const url = new URL(source?.url);
        return url.protocol !== "https:" || url.hostname !== source.host ||
          !classifyResearchPublisher(source.source, url.href).accepted;
      } catch { return true; }
    })) return { ok: false, status: "claim_source_publisher_identity_invalid" };

    const expectedFingerprint = await fingerprintClaim(claim);
    if (reviewed.claim_fingerprint_sha256 !== expectedFingerprint) {
      return { ok: false, status: "claim_or_evidence_fingerprint_mismatch" };
    }

    const expectedReviewFingerprint = await fingerprintReviewDecision(reviewed);
    if (reviewed.review_fingerprint_sha256 !== expectedReviewFingerprint) {
      return { ok: false, status: "review_decision_fingerprint_mismatch" };
    }
  }

  const evidenceSummary = {
    claims_with_contradicting_evidence: [],
    claims_with_insufficient_evidence: [],
    evidence_decision_counts: { supports: 0, contradicts: 0, insufficient: 0 }
  };
  for (const reviewed of record.claims) {
    const decisions = reviewed.evidence_reviews.map(review => review.decision);
    for (const decision of decisions) evidenceSummary.evidence_decision_counts[decision] += 1;
    if (decisions.includes("contradicts")) evidenceSummary.claims_with_contradicting_evidence.push(reviewed.claim_id);
    if (decisions.includes("insufficient")) evidenceSummary.claims_with_insufficient_evidence.push(reviewed.claim_id);
  }
  evidenceSummary.contradiction_count = evidenceSummary.evidence_decision_counts.contradicts;
  evidenceSummary.insufficient_count = evidenceSummary.evidence_decision_counts.insufficient;

  const reviewerIdentityAuthenticated = authenticatedReviewer?.authenticated === true &&
    typeof authenticatedReviewer.reviewer_ref === "string" &&
    authenticatedReviewer.reviewer_ref === record.reviewer_ref;

  return {
    ok: true,
    status: "human_review_record_verified",
    claims_verified: ledger.claims.length,
    reviewer_ref: record.reviewer_ref,
    reviewed_at: record.reviewed_at,
    evidence_summary: evidenceSummary,
    limitations: [
      "Verification confirms that the record matches the supplied ledger snapshot. Reviewer identity is authenticated only when a server-verified Google session matches the record reviewer reference.",
      "Verification does not establish factual truth, source authority, semantic support, originality, licensing, or copyright clearance.",
      "A verified review record does not authorize drafting, catalog writes, public publication, or social posting."
    ],
    safety: {
      record_integrity_verified: true,
      reviewer_identity_authenticated: reviewerIdentityAuthenticated,
      publication_authorized: false,
      content_published: false,
      social_post_published: false
    }
  };
}
