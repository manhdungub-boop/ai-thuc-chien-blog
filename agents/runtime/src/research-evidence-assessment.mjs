import { classifyResearchPublisher } from "./research-publisher-policy.mjs";

const MIN_INDEPENDENT_SOURCES = 2;
const MAX_AGE_DAYS = 45;
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

function validDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function assessResearchEvidence(evidence, {
  now = Date.now(),
  minIndependentSources = MIN_INDEPENDENT_SOURCES,
  maxAgeDays = MAX_AGE_DAYS
} = {}) {
  const items = Array.isArray(evidence) ? evidence.slice(0, 4) : [];
  const accepted = [];
  const rejected = [];
  const seenUrls = new Set();
  const seenHosts = new Set();
  const cutoff = now - Math.min(90, Math.max(1, Number(maxAgeDays) || MAX_AGE_DAYS)) * 86_400_000;

  for (const item of items) {
    let reason = null;
    let url;
    try {
      url = new URL(item?.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || url.hash) {
        reason = "invalid_source_url";
      }
    } catch {
      reason = "invalid_source_url";
    }
    if (!reason && item?.status !== "source_retrieved_not_fact_checked") reason = "source_not_retrieved";
    const publisherIdentity = !reason ? classifyResearchPublisher(item.source, item.url) : null;
    if (!reason && !publisherIdentity?.accepted) reason = publisherIdentity?.reason || "publisher_identity_not_allowlisted";
    if (!reason && (typeof item.source !== "string" || !item.source.trim() || typeof item.title !== "string" || !item.title.trim())) {
      reason = "missing_source_metadata";
    }
    if (!reason && (typeof item.excerpt !== "string" || item.excerpt.trim().length < 80 || item.excerpt.length > 600)) {
      reason = "invalid_excerpt";
    }
    const publishedAt = !reason ? validDate(item.published_at) : null;
    if (!reason && publishedAt === null) reason = "invalid_publication_date";
    if (!reason && publishedAt > now + MAX_FUTURE_SKEW_MS) reason = "future_publication_date";
    if (!reason && publishedAt < cutoff) reason = "stale_source";
    const normalizedUrl = !reason ? url.href : null;
    if (!reason && seenUrls.has(normalizedUrl)) reason = "duplicate_source_url";
    if (!reason && seenHosts.has(url.hostname)) reason = "duplicate_publisher_domain";

    if (reason) {
      rejected.push({ source: typeof item?.source === "string" ? item.source.slice(0, 80) : "unknown", reason });
      continue;
    }
    seenUrls.add(normalizedUrl);
    seenHosts.add(url.hostname);
    accepted.push({
      source: item.source.slice(0, 80),
      publisher: publisherIdentity.publisher,
      host: url.hostname,
      title: item.title.slice(0, 120),
      url: normalizedUrl,
      published_at: new Date(publishedAt).toISOString()
    });
  }

  const threshold = Math.min(4, Math.max(2, Number(minIndependentSources) || MIN_INDEPENDENT_SOURCES));
  const ready = accepted.length >= threshold;
  return {
    status: ready ? "evidence_packet_ready_for_claim_review" : "insufficient_independent_evidence",
    ready_for_claim_review: ready,
    independent_source_count: accepted.length,
    required_independent_sources: threshold,
    max_source_age_days: Math.min(90, Math.max(1, Number(maxAgeDays) || MAX_AGE_DAYS)),
    accepted_sources: accepted,
    rejected_sources: rejected,
    limitations: [
      "Publisher identity is matched against a small exact host/path/label allowlist; this is provenance classification, not a source-authority endorsement.",
      "Distinct publisher domains and freshness do not prove independent ownership or that sources independently support the same claim.",
      "No claim extraction, factual corroboration, source-authority assessment, originality check, or copyright review is performed."
    ],
    safety: {
      publication_authorized: false,
      draft_created: false,
      catalog_modified: false,
      content_published: false
    }
  };
}
