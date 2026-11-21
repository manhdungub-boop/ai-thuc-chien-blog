import { retrieveResearchEvidence } from "./research-evidence.mjs";

const MAX_UNIQUE_SOURCES = 4;

function blocked(reason, extra = {}) {
  return {
    prepared: false,
    status: "evidence_preparation_blocked",
    reason,
    publication_authorized: false,
    content_published: false,
    ...extra
  };
}

/**
 * Retrieve exact source URLs already attached to a human-authored draft claim manifest,
 * then persist the resulting excerpts against the draft's current version.
 *
 * fetchImpl is mandatory so the caller must supply the runtime's budget-enforcing fetch.
 * This helper does not create drafts, generate claims, assess semantic support, or publish.
 */
export async function prepareDraftEvidenceLedger({
  draftStore,
  artifactId,
  fetchImpl,
  now = Date.now()
}) {
  if (!draftStore || typeof draftStore.getDraft !== "function" ||
      typeof draftStore.storeEvidenceLedger !== "function" ||
      typeof artifactId !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(artifactId) ||
      typeof fetchImpl !== "function" || !Number.isFinite(now)) {
    return blocked("invalid_preparation_request");
  }

  const artifact = await draftStore.getDraft(artifactId);
  if (!artifact) return blocked("artifact_not_found");
  if (artifact.status !== "pending_human_review") return blocked("draft_not_quality_eligible");
  if (artifact.evidence_review?.ledger) return blocked("evidence_ledger_already_exists");
  if (!Array.isArray(artifact.draft?.claims) || artifact.draft.claims.length < 1) {
    return blocked("claim_manifest_required");
  }
  if (!Array.isArray(artifact.draft.sources)) return blocked("draft_sources_required");

  const sourceByUrl = new Map();
  for (const source of artifact.draft.sources) {
    if (source && typeof source.url === "string" && !sourceByUrl.has(source.url)) {
      sourceByUrl.set(source.url, source);
    }
  }

  const urls = new Set();
  for (const claim of artifact.draft.claims) {
    if (!claim || !Array.isArray(claim.evidence_urls) ||
        claim.evidence_urls.length < 2 || claim.evidence_urls.length > 4) {
      return blocked("invalid_claim_evidence_mapping");
    }
    for (const url of claim.evidence_urls) {
      if (typeof url !== "string" || !sourceByUrl.has(url)) {
        return blocked("claim_source_not_in_draft_manifest");
      }
      urls.add(url);
    }
  }
  if (urls.size < 2 || urls.size > MAX_UNIQUE_SOURCES) {
    return blocked("unique_source_limit_exceeded", { unique_sources: urls.size, maximum: MAX_UNIQUE_SOURCES });
  }

  const signals = [...urls].map(url => {
    const source = sourceByUrl.get(url);
    return {
      source: source.publisher,
      title: source.title,
      url,
      published_at: null
    };
  });
  const retrieval = await retrieveResearchEvidence(signals, { fetchImpl, now });
  if (retrieval.retrieved !== signals.length ||
      retrieval.evidence.some(item => item.status !== "source_retrieved_not_fact_checked")) {
    return blocked("source_retrieval_incomplete", {
      attempts: retrieval.attempts,
      retrieved: retrieval.retrieved,
      failed: retrieval.failed,
      evidence_statuses: retrieval.evidence.map(item => item.status)
    });
  }

  const stored = await draftStore.storeEvidenceLedger(artifactId, artifact.version, retrieval.evidence);
  if (!stored?.stored) {
    return blocked(stored?.reason || "evidence_ledger_persistence_failed", {
      current_version: stored?.current_version ?? null
    });
  }
  return {
    prepared: true,
    status: "traceable_evidence_pending_human_review",
    artifact: stored.artifact,
    attempts: retrieval.attempts,
    retrieved: retrieval.retrieved,
    external_calls: retrieval.attempts,
    publication_authorized: false,
    content_published: false,
    notice: "Retrieved excerpts are bound to the current draft version. They remain unverified evidence and require a human reviewer."
  };
}
