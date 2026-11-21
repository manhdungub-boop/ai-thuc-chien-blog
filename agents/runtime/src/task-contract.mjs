const MAX_TASK_BYTES = 8 * 1024;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const CANDIDATE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const ARTICLE_PATH = /^articles\/[a-z0-9][a-z0-9-]{0,150}\.html$/;
const SITE_PATH = /^\/(?:[a-zA-Z0-9/_-]{0,240})$/;

const TASK_FIELDS = Object.freeze(["type", "idempotencyKey", "payload"]);

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
}

function hasSafeText(value, maxLength) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validatePayload(type, payload) {
  if (!isRecord(payload)) return "payload_must_be_object";

  if (type === "content.review") {
    if (!hasExactKeys(payload, ["articlePath"])) return "payload_fields_invalid";
    if (!hasSafeText(payload.articlePath, 170) || !ARTICLE_PATH.test(payload.articlePath)) {
      return "article_path_invalid";
    }
    return null;
  }

  if (type === "ai_bank.candidate_review") {
    if (!hasExactKeys(payload, ["candidateId"])) return "payload_fields_invalid";
    if (!hasSafeText(payload.candidateId, 80) || !CANDIDATE_ID.test(payload.candidateId)) {
      return "candidate_id_invalid";
    }
    return null;
  }

  if (type === "seo.audit") {
    if (!hasExactKeys(payload, ["path"])) return "payload_fields_invalid";
    if (!hasSafeText(payload.path, 241) || !SITE_PATH.test(payload.path) ||
        payload.path.includes("//") || payload.path.includes("..")) {
      return "site_path_invalid";
    }
    return null;
  }

  return "task_type_not_allowed";
}

/**
 * Validates an untrusted task request. This function never executes or persists work.
 * The allowlist is deliberately small and payloads contain only opaque local identifiers.
 */
export function validateTaskRequest(input) {
  if (!isRecord(input)) return { ok: false, error: "task_must_be_object" };

  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return { ok: false, error: "task_not_serializable" };
  }

  if (new TextEncoder().encode(serialized).byteLength > MAX_TASK_BYTES) {
    return { ok: false, error: "task_too_large" };
  }

  if (!hasExactKeys(input, TASK_FIELDS)) {
    return { ok: false, error: "task_fields_invalid" };
  }

  if (!hasSafeText(input.type, 40)) {
    return { ok: false, error: "task_type_invalid" };
  }

  if (!hasSafeText(input.idempotencyKey, 128) || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
    return { ok: false, error: "idempotency_key_invalid" };
  }

  const payloadError = validatePayload(input.type, input.payload);
  if (payloadError) return { ok: false, error: payloadError };

  return {
    ok: true,
    task: Object.freeze({
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: Object.freeze({ ...input.payload }),
    }),
  };
}

export const TASK_CONTRACT_LIMITS = Object.freeze({
  maxBytes: MAX_TASK_BYTES,
  allowedTypes: Object.freeze([
    "content.review",
    "ai_bank.candidate_review",
    "seo.audit",
  ]),
});
