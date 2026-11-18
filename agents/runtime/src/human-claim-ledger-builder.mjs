import { classifyResearchPublisher } from "./research-publisher-policy.mjs";

const MAX_CLAIMS = 40;
const MIN_SOURCES_PER_CLAIM = 2;
const MAX_SOURCES_PER_CLAIM = 4;
const CLAIM_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;

function failure(reason) {
  return { ok: false, status: "human_claim_ledger_rejected", reason, publication_authorized: false };
}

/**
 * Bind human-authored claim statements to exact, already-retrieved source excerpts.
 * This function does not generate claims, assess semantic support, or approve release.
 */
export function buildHumanClaimReviewLedger(claims, retrievedEvidence, { now = Date.now() } = {}) {
  if (!Number.isFinite(now) || !Array.isArray(claims) || claims.length < 1 || claims.length > MAX_CLAIMS) {
    return failure("invalid_claim_batch");
  }
  if (!Array.isArray(retrievedEvidence) || retrievedEvidence.length < MIN_SOURCES_PER_CLAIM ||
      retrievedEvidence.length > MAX_CLAIMS * MAX_SOURCES_PER_CLAIM) {
    return failure("invalid_retrieved_evidence_batch");
  }

  const evidenceByUrl = new Map();
  for (const item of retrievedEvidence) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        item.status !== "source_retrieved_not_fact_checked" ||
        typeof item.source !== "string" || !item.source.trim() || item.source.length > 80 ||
        typeof item.title !== "string" || !item.title.trim() || item.title.length > 120 ||
        typeof item.url !== "string" ||
        typeof item.excerpt !== "string" || item.excerpt.trim().length < 80 || item.excerpt.length > 600) {
      return failure("retrieved_source_missing_required_fields");
    }
    let url;
    try {
      url = new URL(item.url);
      if (url.protocol !== "https:" || url.username || url.password ||
          (url.port && url.port !== "443") || url.hash || url.href !== item.url) {
        return failure("retrieved_source_url_invalid");
      }
    } catch {
      return failure("retrieved_source_url_invalid");
    }
    const publisher = classifyResearchPublisher(item.source, url.href);
    if (!publisher.accepted || evidenceByUrl.has(url.href)) return failure("retrieved_source_not_allowlisted_or_duplicate");
    evidenceByUrl.set(url.href, {
      source: item.source,
      title: item.title,
      url: url.href,
      host: url.hostname,
      excerpt: item.excerpt.trim()
    });
  }

  const seenClaimIds = new Set();
  const ledgerClaims = [];
  for (const claim of claims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim) ||
        Object.keys(claim).some(key => !["claim_id", "claim", "evidence_urls"].includes(key)) ||
        typeof claim.claim_id !== "string" || !CLAIM_ID.test(claim.claim_id) ||
        seenClaimIds.has(claim.claim_id) ||
        typeof claim.claim !== "string" || !claim.claim.trim() || claim.claim.length > 500 ||
        !Array.isArray(claim.evidence_urls) ||
        claim.evidence_urls.length < MIN_SOURCES_PER_CLAIM ||
        claim.evidence_urls.length > MAX_SOURCES_PER_CLAIM ||
        new Set(claim.evidence_urls).size !== claim.evidence_urls.length) {
      return failure("invalid_human_authored_claim");
    }

    const sources = [];
    const hosts = new Set();
    for (const sourceUrl of claim.evidence_urls) {
      const source = evidenceByUrl.get(sourceUrl);
      if (!source) return failure("claim_references_unretrieved_source");
      if (hosts.has(source.host)) return failure("claim_sources_not_domain_independent");
      hosts.add(source.host);
      sources.push(source);
    }
    seenClaimIds.add(claim.claim_id);
    ledgerClaims.push({
      claim_id: claim.claim_id,
      claim: claim.claim.trim(),
      status: "traceable_evidence_pending_human_review",
      sources
    });
  }

  return {
    ok: true,
    status: "all_claims_traceable_pending_human_review",
    created_at: new Date(now).toISOString(),
    claims: ledgerClaims,
    safety: {
      human_review_required: true,
      publication_authorized: false,
      draft_created: false,
      catalog_modified: false,
      content_published: false,
      social_post_published: false
    },
    limitations: [
      "Claim wording is supplied by a human; no factual claims are generated or inferred from source excerpts.",
      "The ledger binds exact retrieved excerpts and provenance but does not determine whether they semantically support or contradict a claim.",
      "A reviewer must inspect every excerpt and record a separate per-source decision before any release-readiness check.",
      "Publisher allowlisting and distinct domains do not prove source authority, ownership independence, factual truth, originality, licensing, or copyright clearance."
    ]
  };
}
