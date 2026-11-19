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

const LOCAL_PROVIDER_CAPABILITIES = new Map([
  ["article-quality-gate", new Set(["quality_review"])],
  ["article-authoring-brief", new Set(["content_draft"])]
]);

// Intentionally empty: no external provider has a trusted, runtime-owned
// quota adapter yet. Do not populate this list from provider-supplied data.
const VERIFIED_EXTERNAL_PROVIDER_ADAPTERS = new Set();

const MAX_QUOTA_AGE_MS = 15 * 60 * 1000;

function isFreshTimestamp(value, now, maxAgeMs) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
}

function isAllowlistedLocalProvider(provider, taskType) {
  return provider?.execution_surface === "agent_runtime" &&
    LOCAL_PROVIDER_CAPABILITIES.get(provider?.id)?.has(taskType) === true;
}

function eligible(provider, taskType, now) {
  if (!provider || typeof provider !== "object") return false;
  if (typeof provider.id !== "string" || provider.id.trim() === "") return false;
  if (provider.status !== "ready") return false;
  if (provider.execution_surface !== "agent_runtime") return false;
  if (!["zero_cost_verified", "no_external_execution"].includes(provider.cost_class)) return false;
  if (!Array.isArray(provider.capabilities) || !provider.capabilities.includes(taskType)) return false;

  // Only a code-registered deterministic local implementation may bypass
  // external quota checks. Provider-supplied labels are not sufficient.
  if (provider.cost_class === "no_external_execution") {
    return isAllowlistedLocalProvider(provider, taskType);
  }

  // A provider-supplied quota snapshot is not authoritative. External
  // inference stays disabled until a trusted adapter is implemented in code.
  if (!VERIFIED_EXTERNAL_PROVIDER_ADAPTERS.has(provider.id)) return false;

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
 * Selects only code-registered local work or external providers backed by
 * a trusted runtime-owned quota adapter. Otherwise defer.
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
  if (matching.some(provider => provider?.cost_class === "no_external_execution" && !isAllowlistedLocalProvider(provider, taskType))) {
    return { action: "defer", provider: null, reason: "local_provider_not_allowlisted" };
  }
  if (matching.some(provider => provider?.cost_class === "zero_cost_verified" && !VERIFIED_EXTERNAL_PROVIDER_ADAPTERS.has(provider?.id))) {
    return { action: "defer", provider: null, reason: "external_provider_adapter_not_verified" };
  }
  if (matching.some(provider => !["zero_cost_verified", "no_external_execution"].includes(provider?.cost_class))) {
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
  localProviderIds: Object.freeze([...LOCAL_PROVIDER_CAPABILITIES.keys()]),
  externalProviderIds: Object.freeze([...VERIFIED_EXTERNAL_PROVIDER_ADAPTERS]),
  failClosed: true,
  paidFallbackAllowed: false,
  unknownCostAllowed: false
});
