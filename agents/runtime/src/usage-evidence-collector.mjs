const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_RESOURCES = 12;
const SOURCES = new Set(["cloudflare_dashboard_export", "cloudflare_api_read_only"]);
const METRICS = new Set([
  "workers_requests",
  "workers_cpu_ms",
  "durable_object_requests",
  "durable_object_storage_bytes",
]);

function invalid(reason) {
  return Object.freeze({
    ok: false,
    validationStatus: "invalid",
    reason,
    plan: "unknown",
    resources: Object.freeze([]),
    sideEffects: Object.freeze([]),
    executionAuthority: false,
  });
}

/**
 * Validates an explicitly supplied Cloudflare usage evidence snapshot.
 * It does not contact Cloudflare, authenticate a source, or prove billing-plan status.
 * "valid" means structurally complete and fresh, not independently attested.
 */
export function validateUsageEvidence(snapshot, { nowMs = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 1 || maxAgeMs > MAX_AGE_MS) return invalid("evidence_input_invalid");

  if (typeof snapshot.source !== "string" || !SOURCES.has(snapshot.source) ||
      typeof snapshot.sourceRef !== "string" || snapshot.sourceRef.trim().length < 4 ||
      snapshot.sourceRef.length > 240 ||
      typeof snapshot.accountRef !== "string" || snapshot.accountRef.trim().length < 4 ||
      snapshot.accountRef.length > 160 ||
      !["free", "paid", "unknown"].includes(snapshot.plan) ||
      typeof snapshot.observedAt !== "string") return invalid("evidence_metadata_invalid");

  const observedAtMs = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedAtMs) || new Date(observedAtMs).toISOString() !== snapshot.observedAt) {
    return invalid("evidence_timestamp_invalid");
  }
  const ageMs = nowMs - observedAtMs;
  if (ageMs < 0 || ageMs > maxAgeMs) return invalid("evidence_stale_or_future");

  if (!Array.isArray(snapshot.resources) || snapshot.resources.length === 0 ||
      snapshot.resources.length > MAX_RESOURCES) return invalid("evidence_resources_invalid");

  const seen = new Set();
  const resources = [];
  for (const resource of snapshot.resources) {
    if (!resource || typeof resource !== "object" || Array.isArray(resource) ||
        typeof resource.metric !== "string" || !METRICS.has(resource.metric) ||
        seen.has(resource.metric) ||
        !Number.isSafeInteger(resource.used) || resource.used < 0 ||
        !Number.isSafeInteger(resource.limit) || resource.limit < 1 ||
        resource.used > resource.limit) return invalid("evidence_resource_invalid");
    seen.add(resource.metric);
    resources.push(Object.freeze({
      metric: resource.metric,
      used: resource.used,
      limit: resource.limit,
      remaining: resource.limit - resource.used,
    }));
  }

  const status = snapshot.plan === "free" ? "valid_free_plan_claim"
    : snapshot.plan === "paid" ? "valid_paid_plan_claim"
      : "valid_plan_unconfirmed";

  return Object.freeze({
    ok: true,
    validationStatus: "valid",
    status,
    source: snapshot.source,
    sourceRef: snapshot.sourceRef,
    accountRef: snapshot.accountRef,
    plan: snapshot.plan,
    observedAt: snapshot.observedAt,
    ageMs,
    resources: Object.freeze(resources),
    limitations: Object.freeze([
      "caller_supplied_evidence_not_independently_authenticated",
      "not_a_live_cloudflare_usage_query",
      "not_a_guarantee_of_future_free_tier_headroom",
    ]),
    sideEffects: Object.freeze([]),
    executionAuthority: false,
  });
}

export const USAGE_EVIDENCE_POLICY = Object.freeze({
  maxAgeMs: MAX_AGE_MS,
  maxResources: MAX_RESOURCES,
  allowedMetrics: Object.freeze([...METRICS]),
  contactsCloudflare: false,
  authenticatesSource: false,
  grantsExecutionAuthority: false,
});
