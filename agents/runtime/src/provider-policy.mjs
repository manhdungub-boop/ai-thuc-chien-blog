const TASK_TYPES = new Set([
  "ai_bank_discovery",
  "content_research",
  "content_draft",
  "quality_review",
  "media_image",
  "media_video",
  "social_publish",
  "social_engagement"
]);

const MAX_QUOTA_AGE_MS = 15 * 60 * 1000;

function isFreshTimestamp(value, now, maxAgeMs) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
}

function eligible(provider, taskType, now) {
  if (!provider || typeof provider !== "object") return false;
  if (provider.status !== "ready") return false;
  if (provider.execution_surface !== "agent_runtime") return false;
  if (provider.cost_class !== "zero_cost_verified") return false;
  if (!Array.isArray(provider.capabilities) || !provider.capabilities.includes(taskType)) return false;

  // Runtime inference providers must carry a fresh, positive quota observation.
  // Deterministic local providers may explicitly declare no_external_execution.
  if (provider.cost_class === "no_external_execution") return true;
  const quota = provider.quota;
  return Boolean(
    quota &&
    quota.available === true &&
    Number.isFinite(quota.remaining) &&
    quota.remaining > 0 &&
    isFreshTimestamp(quota.checked_at, now, MAX_QUOTA_AGE_MS)
  );
}

/**
 * Selects the highest-priority provider only when its runtime access, task
 * capability, zero-cost classification, and live quota evidence are verified.
 * Returns a defer decision instead of guessing when evidence is missing.
 */
export function selectProvider(taskType, providers, now = Date.now()) {
  if (!TASK_TYPES.has(taskType)) {
    return { action: "reject", provider: null, reason: "task_type_not_allowed" };
  }
  if (!Array.isArray(providers)) {
    return { action: "defer", provider: null, reason: "provider_snapshot_missing" };
  }

  const candidates = providers
    .filter(provider => eligible(provider, taskType, now))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  if (candidates.length > 0) {
    return {
      action: "execute",
      provider: candidates[0].id,
      reason: "verified_free_runtime_provider_available"
    };
  }

  const matching = providers.filter(provider =>
    Array.isArray(provider?.capabilities) && provider.capabilities.includes(taskType)
  );
  if (matching.length === 0) {
    return { action: "defer", provider: null, reason: "no_provider_for_task" };
  }
  if (matching.some(provider => provider?.execution_surface !== "agent_runtime" && provider?.status === "ready")) {
    return { action: "defer", provider: null, reason: "connector_not_callable_from_agent_runtime" };
  }
  if (matching.some(provider => provider?.cost_class !== "zero_cost_verified")) {
    return { action: "defer", provider: null, reason: "free_cost_not_verified" };
  }
  if (matching.some(provider => provider?.status === "quota_exhausted" || provider?.quota?.available === false)) {
    return { action: "defer", provider: null, reason: "all_verified_free_quotas_exhausted" };
  }
  if (matching.some(provider => provider?.quota && !isFreshTimestamp(provider.quota.checked_at, now, MAX_QUOTA_AGE_MS))) {
    return { action: "defer", provider: null, reason: "quota_evidence_stale" };
  }
  return { action: "defer", provider: null, reason: "provider_status_or_quota_unverified" };
}

export const providerPolicy = Object.freeze({
  taskTypes: Object.freeze([...TASK_TYPES]),
  maxQuotaAgeMs: MAX_QUOTA_AGE_MS,
  failClosed: true,
  paidFallbackAllowed: false,
  unknownCostAllowed: false
});
