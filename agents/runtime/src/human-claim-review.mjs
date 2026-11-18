const MAX_CLAIMS = 40;
const MIN_NOTE_CHARS = 20;
const MAX_NOTE_CHARS = 500;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const DECISIONS = new Set(["supported", "unsupported", "needs_revision"]);

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validReviewerRef(value) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,63}$/.test(value);
}

function validIsoTimestamp(value, now) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value &&
    parsed <= now + MAX_FUTURE_SKEW_MS;
}

function validEvidenceSnapshot(sources) {
  if (!Array.isArray(sources) || sources.length < 2 || sources.length > 4) return false;
  const hosts = new Set();
  const urls = new Set();
  for (const source of sources) {
    if (typeof source?.url !== "string" || typeof source?.host !== "string" ||
        typeof source?.excerpt !== "string" || source.excerpt.length < 80 ||
        source.excerpt.length > 600) return false;
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.username || url.password ||
          (url.port && url.port !== "443") || url.hostname !== source.host) return false;
      if (urls.has(url.href) || hosts.has(url.hostname)) return false;
      urls.add(url.href);
      hosts.add(url.hostname);
    } catch {
      return false;
    }
  }
  return hosts.size >= 2;
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
    evidence_urls: reviewedClaim.evidence_urls
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Record a complete, explicit human review of a traceable claim batch.
 * A "supported" decision records the reviewer's judgment about the cited
 * excerpts; it does not certify truth, originality, legal clearance, or release.
 */
export async function recordHumanClaimReview(ledger, decisions, reviewer, {
  now = Date.now()
} = {}) {
  if (ledger?.status !== "all_claims_traceable_pending_human_review" ||
      ledger?.safety?.human_review_required !== true ||
      ledger?.safety?.publication_authorized !== false ||
      !Array.isArray(ledger.claims) || ledger.claims.length < 1 ||
      ledger.claims.length > MAX_CLAIMS) {
    return { ok: false, status: "invalid_review_ledger" };
  }

  const reviewerRef = cleanString(reviewer?.reviewer_ref);
  const reviewedAt = reviewer?.reviewed_at;
  if (!validReviewerRef(reviewerRef) || !validIsoTimestamp(reviewedAt, now)) {
    return { ok: false, status: "invalid_reviewer_metadata" };
  }
  if (!Array.isArray(decisions) || decisions.length !== ledger.claims.length) {
    return { ok: false, status: "review_decisions_incomplete" };
  }

  const claimById = new Map();
  for (const claim of ledger.claims) {
    if (typeof claim?.claim_id !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(claim.claim_id) ||
        typeof claim.claim !== "string" || !claim.claim.trim() ||
        claim.status !== "traceable_evidence_pending_human_review" ||
        !validEvidenceSnapshot(claim.sources) ||
        claimById.has(claim.claim_id)) {
      return { ok: false, status: "invalid_review_ledger_claim" };
    }
    claimById.set(claim.claim_id, claim);
  }

  const decisionById = new Map();
  for (const item of decisions) {
    const claimId = item?.claim_id;
    const decision = item?.decision;
    const note = cleanString(item?.reviewer_note);
    if (typeof claimId !== "string" || !claimById.has(claimId) ||
        decisionById.has(claimId) || !DECISIONS.has(decision) ||
        note.length < MIN_NOTE_CHARS || note.length > MAX_NOTE_CHARS) {
      return { ok: false, status: "invalid_review_decision" };
    }
    decisionById.set(claimId, { decision, reviewer_note: note });
  }

  if (decisionById.size !== claimById.size) {
    return { ok: false, status: "review_decisions_incomplete" };
  }

  const reviewedClaims = [];
  for (const claim of ledger.claims) {
    const review = decisionById.get(claim.claim_id);
    const reviewedClaim = {
      claim_id: claim.claim_id,
      claim: claim.claim,
      decision: review.decision,
      reviewer_note: review.reviewer_note,
      reviewer_ref: reviewerRef,
      reviewed_at: reviewedAt,
      claim_fingerprint_sha256: await fingerprintClaim(claim),
      evidence_urls: claim.sources.map(source => source.url)
    };
    reviewedClaim.review_fingerprint_sha256 = await fingerprintReviewDecision(reviewedClaim);
    reviewedClaims.push(reviewedClaim);
  }

  return {
    ok: true,
    status: "human_review_recorded_pending_release_gates",
    reviewer_ref: reviewerRef,
    reviewed_at: reviewedAt,
    claims_received: ledger.claims.length,
    claims_reviewed: reviewedClaims.length,
    claims: reviewedClaims,
    limitations: [
      "The recorded decision is the named reviewer's judgment about the cited excerpts, not an automated fact-check.",
      "A supported decision does not establish truth, source authority, originality, license compatibility, or copyright clearance.",
      "This record does not authorize article drafting, catalog writes, public publication, or social posting."
    ],
    safety: {
      human_review_recorded: true,
      publication_authorized: false,
      draft_created: false,
      catalog_modified: false,
      content_published: false,
      social_post_published: false
    }
  };
}
