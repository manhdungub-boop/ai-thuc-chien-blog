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
    const notConfigured = session?.reason === "reviewer_auth_not_configured";
    return { ok: false, status: notConfigured ? 503 : 401, error: session?.reason || "reviewer_session_invalid" };
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
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const allowed = String(env.AGENT_OPERATOR_ALLOWED_EMAILS || "").split(/[\s,]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const email = String(auth.reviewer?.email || "").toLowerCase();
  if (!email || !allowed.includes(email)) return json({ ok: false, error: "operator_not_allowlisted" }, 403);

  if (request.method === "GET") {
    const [controlResult, usageResult] = await Promise.all([
      stateStoreRequest(env, "/control"),
      stateStoreRequest(env, "/usage")
    ]);
    if (!controlResult.ok) return json(controlResult.body, controlResult.status);
    const usage = usageResult.ok ? usageResult.body : {};
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
          accepted_today: usage.acceptedToday ?? 0,
          in_flight: usage.inFlight ?? 0,
          daily_limit: 100,
          concurrency_limit: 5
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

async function handleReviewerApi(request, env, url) {
  if (!sameOrigin(request, request.method === "POST")) return json({ ok: false, error: "same_origin_required" }, 403);
  const auth = await reviewerSession(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
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
    if (request.method === "GET" && url.pathname === "/operator-console") return staticResponse(OPERATOR_CONSOLE_HTML, "text/html; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/operator-console.js") return staticResponse(OPERATOR_CONSOLE_JS, "application/javascript; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/reviewer-console") return staticResponse(REVIEWER_CONSOLE_HTML, "text/html; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/reviewer-console.js") return staticResponse(REVIEWER_CONSOLE_JS, "application/javascript; charset=utf-8");
    if (url.pathname === "/api/operator/runtime-control") return handleOperatorControl(request, env, url);
    if (url.pathname.startsWith("/api/reviewer/")) return handleReviewerApi(request, env, url);
    return null;
  } catch {
    return json({ ok: false, error: "reviewer_route_unavailable" }, 503);
  }
}
