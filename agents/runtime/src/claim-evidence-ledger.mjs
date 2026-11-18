const MAX_CLAIMS = 40;
const MAX_CLAIM_CHARS = 500;
const MAX_EVIDENCE_PER_CLAIM = 4;
const MIN_SOURCES_PER_CLAIM = 2;
const MIN_EXCERPT_CHARS = 80;
const MAX_EXCERPT_CHARS = 600;

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
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
      const excerpt = trimmedString(item.excerpt);
      if (url.protocol !== "https:" || !excerpt ||
          excerpt.length < MIN_EXCERPT_CHARS || excerpt.length > MAX_EXCERPT_CHARS) continue;
      evidenceByUrl.set(url.href, {
        url: url.href,
        host: url.hostname,
        source: trimmedString(item.source).slice(0, 80) || "unknown",
        title: trimmedString(item.title).slice(0, 120),
        excerpt
      });
    } catch {
      // Invalid evidence URLs are omitted from the ledger.
    }
  }

  const seenIds = new Set();
  const claimResults = input.map((claim, index) => {
    const rawId = trimmedString(claim?.id);
    const rawText = trimmedString(claim?.text);
    const id = rawId.length <= 64 ? rawId : "";
    const text = rawText.length <= MAX_CLAIM_CHARS ? rawText : "";
    const rawUrls = claim?.evidence_urls;
    let reason = null;

    if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(id) || seenIds.has(id)) {
      reason = "invalid_or_duplicate_claim_id";
    } else if (!text) {
      reason = rawText.length > MAX_CLAIM_CHARS ? "claim_text_too_long" : "missing_claim_text";
    } else if (!Array.isArray(rawUrls)) {
      reason = "missing_evidence_mapping";
    } else if (rawUrls.length > MAX_EVIDENCE_PER_CLAIM) {
      reason = "too_many_evidence_references";
    }
    if (id) seenIds.add(id);

    const mapped = [];
    const seenClaimUrls = new Set();
    if (!reason) {
      for (const rawUrl of rawUrls) {
        if (typeof rawUrl !== "string") {
          reason = "invalid_evidence_reference";
          break;
        }
        let normalized;
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port && parsed.port !== "443") {
            reason = "invalid_evidence_reference";
            break;
          }
          normalized = parsed.href;
        } catch {
          reason = "invalid_evidence_reference";
          break;
        }
        if (seenClaimUrls.has(normalized)) continue;
        seenClaimUrls.add(normalized);
        const source = evidenceByUrl.get(normalized);
        if (!source) {
          reason = "unaccepted_evidence_reference";
          break;
        }
        mapped.push(source);
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
