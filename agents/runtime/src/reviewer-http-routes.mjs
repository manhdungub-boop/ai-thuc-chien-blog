import { readBoundedJson } from "./bounded-json-body.mjs";
import { handleGoogleReviewerAuth, readGoogleReviewerSessionCookie, verifyGoogleReviewerSessionToken } from "./google-reviewer-oauth.mjs";
import { OPERATOR_CONSOLE_HTML, OPERATOR_CONSOLE_JS } from "./operator-console.mjs";
import { REVIEWER_CONSOLE_HTML, REVIEWER_CONSOLE_JS } from "./reviewer-console.mjs";

const STATIC_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...STATIC_HEADERS, "Content-Type": "application/json; charset=utf-8" } });
}
function staticResponse(body, type) {
  return new Response(body, { status: 200, headers: { ...STATIC_HEADERS, "Content-Type": type } });
}
function sameOrigin(request, requireOrigin = false) {
  const origin = request.headers.get("Origin");
  if (requireOrigin && origin !== new URL(request.url).origin) return false;
  if (origin && origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  return !site || site === "same-origin" || site === "none";
}
async function readJson(request, maxBytes) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return { ok: false, status: 415, error: "json_content_type_required" };
  const parsed = await readBoundedJson(request, maxBytes);
  if (!parsed.ok) return { ok: false, status: parsed.status, error: parsed.error || "request_invalid" };
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return { ok: false, status: 400, error: "request_object_required" };
  return parsed;
}
function isReviewedReleaseIdentity(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 1200) return false;
  let identity;
  try { identity = JSON.parse(value); } catch { return false; }
  if (!Array.isArray(identity) || identity.length !== 2 ||
      typeof identity[0] !== "string" || typeof identity[1] !== "string" ||
      JSON.stringify(identity) !== value) return false;
  try {
    const url = new URL(identity[0]);
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        (url.port && url.port !== "443")) return false;
  } catch { return false; }
  const publishedAt = Date.parse(identity[1]);
  return Number.isFinite(publishedAt) && new Date(publishedAt).toISOString() === identity[1];
}

function aiBankCandidateStore(env) {
  const namespace = env.AGENT_AI_BANK_CANDIDATE_STORE;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") return null;
  return namespace.get(namespace.idFromName("agent-ai-bank-candidates-primary"));
}

async function aiBankCandidateStoreRequest(store, path) {
  try {
    if (!store || typeof store.fetch !== "function") return { ok: false, status: 503, body: null };
    const response = await store.fetch(new Request("https://ai-bank-candidate-store.internal" + path, { method: "GET" }));
    const parsed = await readBoundedJson(response, 256 * 1024);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return { ok: false, status: 502, body: null };
    }
    return { ok: response.ok, status: response.status, body: parsed.value };
  } catch {
    return { ok: false, status: 503, body: null };
  }
}
function draftStore(env) {
  const namespace = env.AGENT_DRAFT_STORE;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") return null;
  return namespace.get(namespace.idFromName("agent-draft-store-primary"));
}
async function reviewerSession(request, env) {
  const token = readGoogleReviewerSessionCookie(request);
  if (!token) return { ok: false, status: 401, error: "reviewer_session_required" };
  const session = await verifyGoogleReviewerSessionToken(token, env);
  if (!session?.authenticated) {
    const status = session?.status || "reviewer_session_invalid";
    const notConfigured = status === "reviewer_auth_not_configured";
    return { ok: false, status: notConfigured ? 503 : 401, error: status };
  }
  return { ok: true, token, reviewer: session.reviewer };
}
function parseLimit(url) {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 20;
  if (!/^[0-9]{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 50 ? value : null;
}
function resultStatus(result, fallback = 200) {
  if (!result || typeof result !== "object") return 502;
  if (result.authorized === false) return result.reason === "reviewer_auth_not_configured" ? 503 : 401;
  if (result.updated === false || result.recorded === false) {
    if (result.error === "draft_not_found") return 404;
    return 409;
  }
  return fallback;
}
function reviewerResultResponse(result) {
  if (!result || typeof result !== "object") {
    return json({ ok: false, error: "reviewer_store_response_invalid", publication_authorized: false }, 502);
  }
  const status = resultStatus(result);
  if (result.authorized === false) {
    return json({ ok: false, error: result.reason || "reviewer_session_invalid", publication_authorized: false }, status);
  }
  const { authorized, reviewer_ref, ...body } = result;
  if (Array.isArray(body.items)) body.count = body.items.length;
  return json({ ...body, publication_authorized: false }, status);
}

function controlView(control) {
  if (!control || typeof control !== "object") return null;
  return {
    paused: control.paused === true,
    changed_at: control.changedAt ?? null,
    version: control.version ?? 0,
    failure_count_last_10m: control.failureCountLast10m ?? 0,
    circuit_breaker_threshold: control.circuitBreakerThreshold ?? 5,
    circuit_breaker_window_ms: control.circuitBreakerWindowMs ?? 600000
  };
}
async function stateStoreRequest(env, path, method = "GET", body) {
  const namespace = env.AGENT_STATE_STORE;
  const token = env.AGENT_STATE_STORE_TOKEN;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function" || typeof token !== "string" || token.length < 32) {
    return { ok: false, status: 503, body: { ok: false, error: "operator_control_not_configured" } };
  }
  try {
    const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
    const headers = { Authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await stub.fetch(new Request(`https://state-store.internal${path}`, init));
    const parsed = await readBoundedJson(response, 16 * 1024);
    if (!parsed.ok) return { ok: false, status: parsed.status, body: { ok: false, error: "state_store_response_invalid" } };
    return { ok: response.ok, status: response.status, body: parsed.value };
  } catch {
    return { ok: false, status: 503, body: { ok: false, error: "state_store_unavailable" } };
  }
}
async function handleOperatorControl(request, env, url) {
  if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (request.method === "POST" && !sameOrigin(request, true)) return json({ ok: false, error: "same_origin_required" }, 403);
  if (!sameOrigin(request)) return json({ ok: false, error: "same_origin_required" }, 403);
  if (env.AGENT_OPERATOR_CONTROL_ENABLED !== "true") return json({ ok: false, error: "operator_control_disabled" }, 503);
  const auth = await reviewerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error, publication_authorized: false }, auth.status);
  const allowed = String(env.AGENT_OPERATOR_ALLOWED_EMAILS || "").split(/[\s,]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const email = String(auth.reviewer?.email || "").toLowerCase();
  if (!email || !allowed.includes(email)) return json({ ok: false, error: "operator_not_allowlisted" }, 403);

  if (request.method === "GET") {
    const [controlResult, usageResult] = await Promise.all([
      stateStoreRequest(env, "/control"),
      stateStoreRequest(env, "/usage")
    ]);
    if (!controlResult.ok) return json(controlResult.body, controlResult.status);
    const usage = usageResult.ok ? usageResult.body : null;
    const usageAvailable = Boolean(usage &&
      Number.isSafeInteger(usage.acceptedToday) && usage.acceptedToday >= 0 &&
      Number.isSafeInteger(usage.inFlight) && usage.inFlight >= 0 &&
      Number.isSafeInteger(usage.dailyLimit) && usage.dailyLimit >= 1 &&
      Number.isSafeInteger(usage.concurrentLimit) && usage.concurrentLimit >= 1);
    return json({
      ok: true,
      control: controlView(controlResult.body.control),
      health: {
        enabled: env.AGENT_ENABLED === "true",
        paused: env.AGENT_PAUSED !== "false",
        scheduler: env.AGENT_SCHEDULE_MODE || "manual_only_no_cron",
        task_execution_enabled: false,
        quality_review_executor_registered: false,
        quality_review_executor_enabled: false,
        task_admission: {
          available: usageAvailable,
          accepted_today: usageAvailable ? usage.acceptedToday : null,
          in_flight: usageAvailable ? usage.inFlight : null,
          daily_limit: usageAvailable ? usage.dailyLimit : null,
          concurrency_limit: usageAvailable ? usage.concurrentLimit : null
        }
      }
    });
  }

  const parsed = await readJson(request, 2048);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
  if (!Object.keys(parsed.value).every((key) => ["action", "reason"].includes(key)) ||
      !["pause", "resume"].includes(parsed.value.action) ||
      typeof parsed.value.reason !== "string" || parsed.value.reason.length < 12 || parsed.value.reason.length > 160) {
    return json({ ok: false, error: "operator_control_request_invalid" }, 400);
  }
  const actor = auth.reviewer?.reviewer_ref;
  if (typeof actor !== "string" || !/^[a-zA-Z0-9._:-]{3,64}$/.test(actor)) return json({ ok: false, error: "operator_actor_invalid" }, 403);
  const result = await stateStoreRequest(env, `/control/${parsed.value.action}`, "POST", {
    actor,
    requestId: crypto.randomUUID(),
    reason: parsed.value.reason
  });
  return json(result.body, result.status);
}

export function isValidReviewerDraftAuthoringRequest(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every(key => ["expected_version", "draft"].includes(key)) &&
    Number.isSafeInteger(value.expected_version) &&
    value.draft &&
    typeof value.draft === "object" &&
    !Array.isArray(value.draft)
  );
}

async function handleAIBankReviewerApi(request, env, url) {
  const collection = url.pathname === "/api/reviewer/ai-bank/candidates";
  const detail = url.pathname.match(/^\/api\/reviewer\/ai-bank\/candidates\/([a-zA-Z0-9_.-]{1,100})\/([a-zA-Z0-9_.-]{1,100})$/);
  const evidenceMatch = url.pathname.match(/^\/api\/reviewer\/ai-bank\/candidates\/([a-zA-Z0-9_.-]{1,100})\/([a-zA-Z0-9_.-]{1,100})\/evidence$/);
  if (!collection && !detail && !evidenceMatch) return null;
  if (evidenceMatch) {
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    if (!sameOrigin(request, true)) return json({ ok: false, error: "review_request_origin_or_content_type_rejected" }, 403);
    const writerAuth = await reviewerSession(request, env);
    if (!writerAuth.ok) return json({ ok: false, error: writerAuth.error }, writerAuth.status);
    const parsed = await readJson(request, 16 * 1024);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = parsed.value;
    const allowedBodyKeys = ["audit_event_id", "evidence", "reviewed_release_identity"];
    const evidenceKeys = ["check_type", "source_title", "source_url", "excerpt"];
    if (Object.keys(body).some(key => !allowedBodyKeys.includes(key)) ||
        Object.keys(body).length !== 3 ||
        typeof body.audit_event_id !== "string" ||
        !isReviewedReleaseIdentity(body.reviewed_release_identity) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.audit_event_id) ||
        !body.evidence || typeof body.evidence !== "object" || Array.isArray(body.evidence) ||
        Object.keys(body.evidence).length !== 4 || Object.keys(body.evidence).some(key => !evidenceKeys.includes(key))) {
      return json({ ok: false, error: "ai_bank_evidence_request_invalid", evidence_recorded: false }, 400);
    }
    const store = aiBankCandidateStore(env);
    if (!store || typeof store.submitAuthorizedReviewEvidence !== "function") {
      return json({ ok: false, error: "ai_bank_candidate_store_unavailable", evidence_recorded: false }, 503);
    }
    const candidateId = "github:" + evidenceMatch[1] + "/" + evidenceMatch[2];
    const writerAuthConfig = {
      AGENT_REVIEWER_AUTH_ENABLED: env.AGENT_REVIEWER_AUTH_ENABLED,
      GOOGLE_REVIEWER_CLIENT_ID: env.GOOGLE_REVIEWER_CLIENT_ID,
      GOOGLE_REVIEWER_CLIENT_SECRET: env.GOOGLE_REVIEWER_CLIENT_SECRET,
      GOOGLE_REVIEWER_REDIRECT_URI: env.GOOGLE_REVIEWER_REDIRECT_URI,
      GOOGLE_REVIEWER_ALLOWED_EMAILS: env.GOOGLE_REVIEWER_ALLOWED_EMAILS,
      GOOGLE_REVIEWER_STATE_SECRET: env.GOOGLE_REVIEWER_STATE_SECRET,
      GOOGLE_REVIEWER_SESSION_SECRET: env.GOOGLE_REVIEWER_SESSION_SECRET,
      GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: env.GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS
    };
    let result;
    try {
      result = await store.submitAuthorizedReviewEvidence(
        candidateId, body.evidence, writerAuth.token, body.audit_event_id, body.reviewed_release_identity, writerAuthConfig
      );
    } catch {
      return json({ ok: false, error: "ai_bank_evidence_writer_unavailable", evidence_recorded: false }, 503);
    }
    if (!result || !result.accepted) {
      const reason = result?.reason || "ai_bank_evidence_writer_unavailable";
      const status = reason === "evidence_writer_not_allowlisted" ? 403 :
        reason === "stale_candidate_release" || reason === "duplicate_audit_event" || reason === "audit_event_id_reused" ? 409 :
        reason === "reviewed_release_identity_required" || reason === "invalid_reviewed_release_identity" ? 400 :
        reason === "evidence_audit_daily_limit_reached" ? 429 :
        reason === "evidence_audit_capacity_reached" || reason === "reviewer_auth_not_configured" || reason === "evidence_writer_not_configured" ? 503 :
        reason === "reviewer_session_invalid" || reason === "reviewer_session_expired" ? 401 : 400;
      return json({ ok: false, error: reason, evidence_recorded: false }, status);
    }
    return json({
      accepted: true,
      evidence: { evidence_id: result.evidence_id, source_status: result.source_status, review_status: result.review_status },
      audit_event_id: result.audit_event_id,
      replay_protected: result.replay_protected,
      verification_authorized: false,
      catalog_write_authorized: false,
      public_publication_authorized: false
    }, 201);
  }
  if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!sameOrigin(request)) return json({ ok: false, error: "review_request_origin_or_content_type_rejected" }, 403);
  const auth = await reviewerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error, publication_authorized: false }, auth.status);

  let limit = 20;
  if (collection) {
    const values = url.searchParams.getAll("limit");
    if (values.length > 1 || (values.length === 1 && !/^(?:[1-9]|1[0-9]|20)$/.test(values[0]))) {
      return json({ ok: false, error: "invalid_ai_bank_candidate_limit" }, 400);
    }
    if (values.length === 1) limit = Number(values[0]);
  }

  const store = aiBankCandidateStore(env);
  if (!store) return json({ ok: false, error: "ai_bank_candidate_store_unavailable" }, 503);
  const safety = {
    catalog_write_authorized: false,
    evidence_verification_authorized: false,
    public_publication_authorized: false
  };
  if (collection) {
    const result = await aiBankCandidateStoreRequest(store, "/candidates?limit=" + limit);
    const items = result.body?.items;
    if (!result.ok || !Array.isArray(items) || items.length > limit) {
      return json({ ok: false, error: "ai_bank_candidate_response_invalid", ...safety }, result.status === 503 ? 503 : 502);
    }
    return json({
      items,
      count: items.length,
      reviewer_ref: auth.reviewer.reviewer_ref,
      ...safety
    });
  }

  const candidateId = "github:" + detail[1] + "/" + detail[2];
  const result = await aiBankCandidateStoreRequest(store, "/candidate?id=" + encodeURIComponent(candidateId));
  const packet = result.body?.packet;
  if (!result.ok || !packet || typeof packet !== "object" || Array.isArray(packet)) {
    return json({ ok: false, error: result.status === 404 ? "ai_bank_candidate_not_found" : "ai_bank_candidate_response_invalid", ...safety }, result.status === 404 ? 404 : 502);
  }
  return json({
    packet,
    reviewer_ref: auth.reviewer.reviewer_ref,
    ...safety
  });
}

async function handleReviewerApi(request, env, url) {
  if (url.pathname.startsWith("/api/reviewer/ai-bank/")) {
    const aiBankResponse = await handleAIBankReviewerApi(request, env, url);
    return aiBankResponse || json({ ok: false, error: "not_found" }, 404);
  }
  if (!sameOrigin(request, request.method === "POST")) return json({ ok: false, error: "same_origin_required" }, 403);
  const auth = await reviewerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error, publication_authorized: false }, auth.status);
  const store = draftStore(env);
  if (!store) return json({ ok: false, error: "draft_store_not_configured" }, 503);
  const limit = parseLimit(url);
  if (limit === null) return json({ ok: false, error: "review_queue_limit_invalid" }, 400);

  if (url.pathname === "/api/reviewer/drafts" && request.method === "GET") {
    const result = await store.listPendingReviewsForReviewer(limit, auth.token);
    return reviewerResultResponse(result);
  }
  if (url.pathname === "/api/reviewer/drafts-needing-authoring" && request.method === "GET") {
    const result = await store.listNeedsRevisionForReviewer(limit, auth.token);
    return reviewerResultResponse(result);
  }

  const authoringMatch = url.pathname.match(/^\/api\/reviewer\/drafts\/([a-zA-Z0-9._:-]{8,128})\/authoring$/);
  if (authoringMatch && request.method === "POST") {
    const parsed = await readJson(request, 48 * 1024);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    if (!isValidReviewerDraftAuthoringRequest(parsed.value)) {
      return json({ ok: false, error: "draft_authoring_request_invalid" }, 400);
    }
    const result = await store.reviseDraftForReviewer(authoringMatch[1], parsed.value.expected_version, parsed.value.draft, auth.token);
    return reviewerResultResponse(result);
  }

  const evidenceMatch = url.pathname.match(/^\/api\/reviewer\/drafts\/([a-zA-Z0-9._:-]{8,128})\/evidence-review$/);
  if (evidenceMatch && request.method === "POST") {
    const parsed = await readJson(request, 96 * 1024);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    if (!Number.isSafeInteger(parsed.value.expected_version) || !Array.isArray(parsed.value.decisions)) {
      return json({ ok: false, error: "evidence_review_request_invalid" }, 400);
    }
    const result = await store.recordReviewerClaimDecisions(evidenceMatch[1], parsed.value.expected_version, parsed.value.decisions, auth.token);
    return reviewerResultResponse(result);
  }

  const detailMatch = url.pathname.match(/^\/api\/reviewer\/drafts\/([a-zA-Z0-9._:-]{8,128})$/);
  if (detailMatch && request.method === "GET") {
    const result = await store.getDraftForReviewer(detailMatch[1], auth.token);
    return reviewerResultResponse(result);
  }
  return json({ ok: false, error: "not_found" }, 404);
}

export async function handleReviewerHttpRequest(request, env) {
  try {
    const authResponse = await handleGoogleReviewerAuth(request, env);
    if (authResponse) return authResponse;
    const url = new URL(request.url);
    const consoleAssets = {
      "/operator-console": [OPERATOR_CONSOLE_HTML, "text/html; charset=utf-8"],
      "/operator-console.js": [OPERATOR_CONSOLE_JS, "application/javascript; charset=utf-8"],
      "/reviewer-console": [REVIEWER_CONSOLE_HTML, "text/html; charset=utf-8"],
      "/reviewer-console.js": [REVIEWER_CONSOLE_JS, "application/javascript; charset=utf-8"],
    };
    if (request.method === "GET" && Object.prototype.hasOwnProperty.call(consoleAssets, url.pathname)) {
      const accessAssertion = request.headers.get("Cf-Access-Jwt-Assertion");
      if (env.AGENT_CONSOLE_ACCESS_PROTECTED !== "true" || !accessAssertion) {
        return json({ ok: false, error: "not_found" }, 404);
      }
      const [body, contentType] = consoleAssets[url.pathname];
      return staticResponse(body, contentType);
    }
    if (url.pathname === "/api/operator/runtime-control") return handleOperatorControl(request, env, url);
    if (url.pathname.startsWith("/api/reviewer/")) return handleReviewerApi(request, env, url);
    return null;
  } catch {
    return json({ ok: false, error: "reviewer_route_unavailable" }, 503);
  }
}
