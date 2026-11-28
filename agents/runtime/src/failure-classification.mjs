const TRANSIENT = new Set([
  "provider_timeout",
  "network_error",
  "upstream_unavailable",
  "service_unavailable",
  "rate_limited",
  "fetch_failed",
  "lease_expired",
  "lease_expired_max_attempts",
]);
const AUTHENTICATION = new Set([
  "unauthorized",
  "authentication_failed",
  "invalid_credentials",
  "token_expired",
  "token_invalid",
  "oauth_scope_missing",
]);
const CONFIGURATION = new Set([
  "configuration_invalid",
  "config_missing",
  "binding_missing",
  "feature_disabled",
  "secret_missing",
]);
const DATA = new Set([
  "payload_invalid",
  "schema_validation_failed",
  "data_integrity_error",
  "json_parse_failed",
  "unsupported_payload",
]);

/**
 * Classify only known, bounded error codes. Unknown codes remain unknown;
 * this is advisory metadata and never changes retry, admission, or task state.
 */
export function classifyTaskFailure(errorCode, lastErrorCode = null) {
  const code = typeof errorCode === "string" && errorCode.length > 0
    ? errorCode
    : typeof lastErrorCode === "string" ? lastErrorCode : "";
  if (TRANSIENT.has(code)) {
    return { category: "transient", confidence: "high", recommendedAction: "inspect_provider_or_network_health" };
  }
  if (AUTHENTICATION.has(code)) {
    return { category: "authentication", confidence: "high", recommendedAction: "verify_credentials_and_scopes" };
  }
  if (CONFIGURATION.has(code)) {
    return { category: "configuration", confidence: "high", recommendedAction: "review_runtime_configuration" };
  }
  if (DATA.has(code)) {
    return { category: "data", confidence: "high", recommendedAction: "inspect_input_and_schema" };
  }
  return { category: "unknown", confidence: "low", recommendedAction: "manual_review" };
}

export const FAILURE_CLASSIFICATION_VALUES = Object.freeze({
  categories: Object.freeze(["transient", "authentication", "configuration", "data", "unknown"]),
  confidences: Object.freeze(["high", "low"]),
  recommendedActions: Object.freeze([
    "inspect_provider_or_network_health",
    "verify_credentials_and_scopes",
    "review_runtime_configuration",
    "inspect_input_and_schema",
    "manual_review",
  ]),
});
