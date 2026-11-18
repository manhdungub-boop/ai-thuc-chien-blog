const MAX_CLAIMS = 40;
const MAX_CLAIM_CHARS = 500;
const MAX_EVIDENCE_PER_CLAIM = 4;
const MIN_SOURCES_PER_CLAIM = 2;
const MIN_EXCERPT_CHARS = 80;

function boundedText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Build a provenance ledger for explicitly supplied factual claims.
 * This validates traceability only; it does not decide whether an excerpt
 * semantically entails, proves, or contradicts a claim.
 */
export function buildClaimEvidenceLedger(claims, evidence, assessment) {
  const suppliedClaims = Array.isArray(claims) ? claims : [];
  const input = suppliedClaims.slice(0, MAX_CLAIMS);
  const claimBatchTruncated = suppliedClaims.length > MAX_CLAIMS;
  const retrieved = Array.isArray(evidence) ? evidence.slice(0, 4) : [];
  const acceptedUrls = new Set(
    (Array.isArray(assessment?.accepted_sources) ? assessment.accepted_sources : [])
      .map(item => item?.url)
      .filter(value => typeof value === "string")
  );
  const evidenceByUrl = new Map();
  for (const item of retrieved) {
    if (item?.status !== "source_retrieved_not_fact_checked" ||
        typeof item.url !== "string" || !acceptedUrls.has(item.url)) continue;
    try {
      const url = new URL(item.url);
      const excerpt = boundedText(item.excerpt, 600);
      if (url.protocol !== "https:" || !excerpt || excerpt.length < MIN_EXCERPT_CHARS) continue;
      evidenceByUrl.set(url.href, {
        url: url.href,
        host: url.hostname,
        source: boundedText(item.source, 80) || "unknown",
        title: boundedText(item.title, 120),
        excerpt
      });
    } catch {
      // Invalid evidence URLs are omitted from the ledger.
    }
  }

  const seenIds = new Set();
  const claimResults = input.map((claim, index) => {
    const id = boundedText(claim?.id, 64);
    const text = boundedText(claim?.text, MAX_CLAIM_CHARS);
    const urls = Array.isArray(claim?.evidence_urls)
      ? claim.evidence_urls.slice(0, MAX_EVIDENCE_PER_CLAIM)
      : [];
    let reason = null;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(id) || seenIds.has(id)) reason = "invalid_or_duplicate_claim_id";
    else if (!text) reason = "missing_claim_text";
    else if (!Array.isArray(claim?.evidence_urls)) reason = "missing_evidence_mapping";
    else if (claim.evidence_urls.length > MAX_EVIDENCE_PER_CLAIM) reason = "too_many_evidence_references";
    if (id) seenIds.add(id);

    const mapped = [];
    const seenClaimUrls = new Set();
    if (!reason) {
      for (const rawUrl of urls) {
        if (typeof rawUrl !== "string") continue;
        let normalized;
        try { normalized = new URL(rawUrl).href; } catch { continue; }
        if (seenClaimUrls.has(normalized)) continue;
        seenClaimUrls.add(normalized);
        const source = evidenceByUrl.get(normalized);
        if (source) mapped.push(source);
      }
    }
    const domains = new Set(mapped.map(source => source.host));
    if (!reason && mapped.length === 0) reason = "no_traceable_evidence";
    else if (!reason && domains.size < MIN_SOURCES_PER_CLAIM) reason = "insufficient_distinct_publishers";

    return {
      claim_id: id || "claim-" + (index + 1),
      claim: text,
      status: reason ? "needs_evidence_or_revision" : "traceable_evidence_pending_human_review",
      reason,
      traceable_source_count: mapped.length,
      distinct_publisher_count: domains.size,
      sources: mapped
    };
  });

  const complete = !claimBatchTruncated && input.length > 0 &&
    claimResults.length === input.length &&
    claimResults.every(item => item.status === "traceable_evidence_pending_human_review");
  return {
    status: complete ? "all_claims_traceable_pending_human_review" : "claim_evidence_review_incomplete",
    claims_received: suppliedClaims.length,
    claim_batch_truncated: claimBatchTruncated,
    claims_assessed: claimResults.length,
    max_claims_assessed: MAX_CLAIMS,
    minimum_distinct_publishers_per_claim: MIN_SOURCES_PER_CLAIM,
    claims: claimResults,
    limitations: [
      ...(claimBatchTruncated ? ["Input exceeded the claim limit; the batch is incomplete and must be split before review."] : []),
      "Traceability confirms only that a claim is linked to retrieved excerpts from distinct publisher domains.",
      "No semantic entailment, factual accuracy, contradiction, source authority, independence of ownership, or claim-level corroboration is assessed.",
      "Every claim remains pending human review; a reviewer must verify that each cited passage actually supports the exact claim."
    ],
    safety: {
      human_review_required: true,
      publication_authorized: false,
      draft_created: false,
      catalog_modified: false,
      content_published: false
    }
  };
}
