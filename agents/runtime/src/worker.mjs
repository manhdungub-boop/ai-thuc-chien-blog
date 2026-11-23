import { hasValidOperatorBearer } from "./operator-auth.mjs";
import { hasValidStateStoreBearer } from "./internal-auth.mjs";
import { readBoundedJson as readBoundedJsonBody, readBoundedText } from "./bounded-json-body.mjs";
import { handleReviewerHttpRequest } from "./reviewer-http-routes.mjs";
import { authorizeGitHubActionsOperator } from "./github-oidc-authorize.mjs";
import { validateTaskRequest } from "./task-contract.mjs";
import { createReadOnlyAgentManager } from "./read-only-agent-manager.mjs";
import { createReadOnlyTaskSnapshotAdapter } from "./task-snapshot-adapters.mjs";
import { createPreviewReadOnlyReaders } from "./preview-read-only-sources.mjs";
import { currentUtcBudgetDay } from "./utc-budget-day.mjs";
import { discoverResearchSignals } from "./research-discovery.mjs";
import { retrieveResearchEvidence } from "./research-evidence.mjs";
import { buildArticleAuthoringBrief } from "./article-authoring-brief.mjs";
import { selectProvider } from "./provider-policy.mjs";
export { AgentStateStore } from "./state-store.mjs";
export { AgentAIBankCandidateStore } from "./ai-bank-candidate-store.mjs";
export { AgentDraftStore } from "./draft-artifact-store.mjs";
export { AgentReviewerAuthStore } from "./google-reviewer-auth-store.mjs";

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
});
const MAX_INTERNAL_RESPONSE_BYTES = 16 * 1024;
const LEASE_HEARTBEAT_INTERVAL_MS = 10_000;
const INTERNAL_SCHEDULED_DISPATCH = Symbol("internal-scheduled-dispatch");
const INTERNAL_OIDC_RUN = Symbol("internal-oidc-run");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}
function isEnabled(value) { return value === "true"; }

const SAFE_TASK_TYPES = new Set(["content.review", "ai_bank.candidate_review", "seo.audit"]);
const SAFE_OIDC_DIAGNOSTIC_CODES = new Set([
  "read_only_source_error",
  "preview_source_http_error",
  "preview_source_body_unavailable",
  "preview_source_too_large",
  "preview_source_invalid_utf8",
  "preview_source_fetch_failed",
  "preview_source_path_not_allowlisted",
  "preview_ai_bank_catalog_invalid",
  "article_source_unavailable",
  "candidate_source_unavailable",
  "seo_source_unavailable",
]);
function isSafeOidcDiagnosticCode(value) {
  return SAFE_OIDC_DIAGNOSTIC_CODES.has(value) ||
    (typeof value === "string" && /^preview_source_(?:http_error|redirect_rejected)_(?:contents|raw|body)_\d{3}$/.test(value));
}
export function safeReviewResult(item) {
  if (!item || item.ok !== true || !SAFE_TASK_TYPES.has(item.taskType) ||
      !["pass", "attention", "review_required"].includes(item.status) ||
      !Number.isSafeInteger(item.findingCount) || item.findingCount < 0 || item.findingCount > 20 ||
      !Array.isArray(item.findings) || item.findings.length !== item.findingCount) {
    return { ok: false, errorCode: "read_only_review_failed" };
  }
  const findings = [];
  for (const finding of item.findings) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding) ||
        Object.keys(finding).sort().join(",") !== "code,message,severity" ||
        typeof finding.code !== "string" || !/^[a-z][a-z0-9_]{1,79}$/.test(finding.code) ||
        !["error", "warning"].includes(finding.severity) ||
        typeof finding.message !== "string" || finding.message.length < 1 || finding.message.length > 256 ||
        finding.message.trim() !== finding.message || /[\u0000-\u001f\u007f]/.test(finding.message)) {
      return { ok: false, errorCode: "read_only_review_failed" };
    }
    findings.push({ code: finding.code, severity: finding.severity, message: finding.message });
  }
  const result = {
    ok: true,
    taskType: item.taskType,
    status: item.status,
    findingCount: item.findingCount,
    findings,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 4096) {
    return { ok: false, errorCode: "read_only_review_failed" };
  }
  return result;
}

function isValidClientIp(address) {
  if (address.includes(":")) {
    try {
      const hostname = new URL("http://[" + address + "]/").hostname;
      return hostname.startsWith("[") && hostname.endsWith("]");
    } catch {
      return false;
    }
  }
  const octets = address.split(".");
  return octets.length === 4 && octets.every((octet) =>
    /^(0|[1-9][0-9]{0,2})$/.test(octet) && Number(octet) <= 255
  );
}

async function enforceIngressRateLimit(request, env) {
  if (env.AGENT_RATE_LIMIT_REQUIRED !== "true") return null;
  const limiter = env.AGENT_INGRESS_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") {
    return json({ ok: false, error: "rate_limit_unavailable" }, 503);
  }
  const address = request.headers.get("cf-connecting-ip");
  if (!address || address.length > 64 || address.trim() !== address || address.includes(",") || !isValidClientIp(address)) {
    return json({ ok: false, error: "client_ip_unavailable" }, 503);
  }
  const key = "ip:" + address;
  try {
    const result = await limiter.limit({ key });
    if (result?.success !== true) return json({ ok: false, error: "rate_limited" }, 429);
    return null;
  } catch {
    return json({ ok: false, error: "rate_limit_unavailable" }, 503);
  }
}



function parseControlJson(text) {
  let index = 0;
  const skipWhitespace = () => {
    while (index < text.length && /[\t\n\r ]/.test(text[index])) index++;
  };
  const readString = () => {
    const start = index;
    if (text[index] !== '"') throw new Error("control_json_invalid");
    index++;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      const character = text[index];
      if (character === '"') {
        index++;
        return JSON.parse(text.slice(start, index));
      }
      if (character === "\\") {
        index++;
        if (index >= text.length) throw new Error("control_json_invalid");
        if (text[index] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5))) throw new Error("control_json_invalid");
          index += 5;
        } else {
          if (!/["\\/bfnrt]/.test(text[index])) throw new Error("control_json_invalid");
          index++;
        }
        continue;
      }
      if (code < 0x20) throw new Error("control_json_invalid");
      index++;
    }
    throw new Error("control_json_invalid");
  };

  skipWhitespace();
  if (text[index++] !== "{") throw new Error("control_json_invalid");
  const result = {};
  const allowedKeys = new Set(["reason", "actor", "requestId", "taskId"]);
  skipWhitespace();
  if (text[index] === "}") {
    index++;
    skipWhitespace();
    if (index !== text.length) throw new Error("control_json_invalid");
    return result;
  }

  while (index < text.length) {
    const key = readString();
    if (!allowedKeys.has(key) || Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error("control_json_invalid");
    }
    skipWhitespace();
    if (text[index++] !== ":") throw new Error("control_json_invalid");
    skipWhitespace();
    result[key] = readString();
    skipWhitespace();
    if (text[index] === "}") {
      index++;
      skipWhitespace();
      if (index !== text.length) throw new Error("control_json_invalid");
      return result;
    }
    if (text[index++] !== ",") throw new Error("control_json_invalid");
    skipWhitespace();
  }
  throw new Error("control_json_invalid");
}

async function readBoundedJsonRequest(request, maxBytes) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declared)) return { ok: false, status: 400 };
    if (Number(declared) > maxBytes) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { ok: true, value: parseControlJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

async function readBoundedControlJson(request, maxBytes) {
  const bounded = await readBoundedText(request, maxBytes);
  if (!bounded.ok) return bounded;
  try { return { ok: true, value: parseControlJson(bounded.value) }; }
  catch { return { ok: false, status: 400, error: "invalid_control_json" }; }
}
async function readBoundedJsonValueRequest(request, maxBytes) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declared)) return { ok: false, status: 400 };
    if (Number(declared) > maxBytes) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

async function writeStateStore(env, pathname, payload) {
  if (!await hasValidStateStoreBearer(
    new Request("https://state-store.internal/", {
      headers: { Authorization: "Bearer " + (env.AGENT_STATE_STORE_TOKEN || "") },
    }),
    env,
  )) throw new Error("internal_auth_unavailable");
  const namespace = env.AGENT_STATE_STORE;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new Error("state_store_binding_unavailable");
  }
  const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
  if (!stub || typeof stub.fetch !== "function") throw new Error("state_store_binding_unavailable");
  const response = await stub.fetch(new Request("https://state-store.internal" + pathname, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.AGENT_STATE_STORE_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }));
  const body = await readBoundedJson(response);
  if (!response.ok || body?.ok !== true) {
    const allowedStatus = [400, 401, 404, 409, 429, 503];
    const status = allowedStatus.includes(response.status) ? response.status : 503;
    throw Object.assign(new Error("state_store_request_failed"), { status });
  }
  return body;
}

export async function runWithLeaseHeartbeat(work, heartbeat, intervalMs = 10_000) {
  if (typeof work !== "function" || typeof heartbeat !== "function" ||
      !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 120_000) {
    throw new Error("lease_heartbeat_configuration_invalid");
  }
  const controller = new AbortController();
  let finished = false;
  let heartbeatFailed = false;
  const workPromise = Promise.resolve().then(() => work(controller.signal)).then(
    (value) => { finished = true; return value; },
    (error) => { finished = true; throw error; },
  );
  while (!finished) {
    let timer;
    await Promise.race([
      workPromise.then(() => undefined, () => undefined),
      new Promise((resolve) => { timer = setTimeout(resolve, intervalMs); }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (finished) break;
    try {
      await heartbeat();
    } catch {
      heartbeatFailed = true;
      controller.abort(new Error("task_lease_heartbeat_unavailable"));
      break;
    }
  }
  if (heartbeatFailed) {
    // Work adapters must honor the signal before each source read/side effect.
    // Wait for cooperative cleanup before returning control to the dispatcher.
    try { await workPromise; } catch {}
    throw new Error("task_lease_heartbeat_unavailable");
  }
  return await workPromise;
}

async function readBoundedJson(response) {
  const parsed = await readBoundedJsonBody(response, MAX_INTERNAL_RESPONSE_BYTES);
  if (!parsed.ok) {
    const code = parsed.status === 413 ? "too_large" : "invalid";
    throw new Error("internal_response_" + code);
  }
  return parsed.value;
}
/** Fixed-identity, allowlisted, server-to-DO call. Never forwards caller headers. */
async function readStateStore(env, pathname) {
  if (!await hasValidStateStoreBearer(
    new Request("https://state-store.internal/", {
      headers: { Authorization: "Bearer " + (env.AGENT_STATE_STORE_TOKEN || "") },
    }),
    env,
  )) throw new Error("internal_auth_unavailable");
  const namespace = env.AGENT_STATE_STORE;
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw new Error("state_store_binding_unavailable");
  }
  const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
  if (!stub || typeof stub.fetch !== "function") throw new Error("state_store_binding_unavailable");
  const internalRequest = new Request("https://state-store.internal" + pathname, {
    method: "GET",
    headers: { Authorization: "Bearer " + env.AGENT_STATE_STORE_TOKEN },
  });
  const response = await stub.fetch(internalRequest);
  const body = await readBoundedJson(response);
  if (!response.ok || body?.ok !== true) {
    const allowedStatus = [400, 401, 404, 409, 429, 503];
    const status = allowedStatus.includes(response.status) ? response.status : 503;
    throw Object.assign(new Error("state_store_request_failed"), { status });
  }
  return body;
}


const AUTHORING_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const CONTENT_RESEARCH_DAILY_LIMIT = 8;

async function consumeContentResearchBudget(env, count) {
  if (!Number.isSafeInteger(count) || count < 0 || count > CONTENT_RESEARCH_DAILY_LIMIT) {
    throw Object.assign(new Error("research_budget_request_invalid"), { status: 503 });
  }
  if (count === 0) return { day: currentUtcBudgetDay(), used: 0, remaining: CONTENT_RESEARCH_DAILY_LIMIT };
  const day = currentUtcBudgetDay();
  const snapshot = await readStateStore(
    env,
    "/external-budget?day=" + encodeURIComponent(day) + "&scope=content_research",
  );
  let budget = snapshot?.budget;
  const validBudget = (value) => value && value.ok === true && value.day === day &&
    value.scope === "content_research" && Number.isSafeInteger(value.used) && value.used >= 0 &&
    value.limit === CONTENT_RESEARCH_DAILY_LIMIT && Number.isSafeInteger(value.remaining) &&
    value.remaining >= 0 && value.used + value.remaining === value.limit;
  if (!validBudget(budget)) {
    throw Object.assign(new Error("research_budget_snapshot_invalid"), { status: 503 });
  }
  if (budget.remaining < count) {
    throw Object.assign(new Error("research_budget_exhausted"), { status: 429 });
  }
  for (let index = 0; index < count; index += 1) {
    const consumed = await writeStateStore(env, "/external-budget/consume", {
      day,
      scope: "content_research",
    });
    const next = consumed?.budget;
    if (!validBudget(next) || next.used < budget.used + 1 || next.remaining > budget.remaining - 1) {
      throw Object.assign(new Error("research_budget_consumption_invalid"), { status: 503 });
    }
    budget = next;
  }
  return { day, used: budget.used, remaining: budget.remaining };
}

async function authoringArtifactId(idempotencyKey, topic) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([idempotencyKey, topic])));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return "authoring-" + hex.slice(0, 48);
}

function authoringArtifactSummary(artifact) {
  if (!artifact || typeof artifact.id !== "string" ||
      !["pending_human_review", "needs_revision"].includes(artifact.status) ||
      !Number.isSafeInteger(artifact.version) || artifact.version < 1 ||
      !artifact.draft || typeof artifact.draft.title !== "string" ||
      typeof artifact.draft.slug !== "string" ||
      artifact.quality_review?.publication_authorized !== false) return null;
  return {
    id: artifact.id,
    status: artifact.status,
    version: artifact.version,
    title: artifact.draft.title,
    slug: artifact.draft.slug,
    quality_status: artifact.quality_review.status || (artifact.quality_review.ok ? "pass" : "needs_revision"),
    human_authoring_required: true,
    publication_authorized: false,
  };
}

const worker = {
  async fetch(request, env = {}, context) {
    if (context !== INTERNAL_SCHEDULED_DISPATCH && context !== INTERNAL_OIDC_RUN) {
      const limited = await enforceIngressRateLimit(request, env);
      if (limited) return limited;
    }
    const reviewerResponse = await handleReviewerHttpRequest(request, env);
    if (reviewerResponse) return reviewerResponse;
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      return json({
        ok: true,
        service: "ai-thuc-chien-agent-runtime-preview",
        enabled: isEnabled(env.AGENT_ENABLED),
        paused: env.AGENT_PAUSED !== "false",
        scheduler: env.AGENT_SCHEDULE_MODE || "manual_only_no_cron",
        task_execution_enabled: false,
        quality_review_executor_registered: false,
        quality_review_executor_enabled: false,
        reviewer_auth_enabled: env.AGENT_REVIEWER_AUTH_ENABLED === "true",
        publication_authorized: false,
        execution: "operator_triggered_read_only_analysis",
      });
    }
    if (url.pathname === "/internal/oidc/run") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (env.AGENT_OIDC_RUN_ENABLED !== "true") return json({ ok: false, error: "oidc_run_disabled" }, 503);
      if (env.AGENT_OIDC_ENABLED !== "true") return json({ ok: false, error: "oidc_operator_disabled" }, 503);
      if (!isEnabled(env.AGENT_ENABLED) || env.AGENT_PAUSED !== "false") {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);

      const parsedBody = await readBoundedJsonValueRequest(request, 2048);
      if (!parsedBody.ok) return json({ ok: false, error: "request_invalid" }, parsedBody.status);
      const body = parsedBody.value;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !Object.hasOwn(body, "task")) {
        return json({ ok: false, error: "oidc_run_request_invalid" }, 400);
      }
      const validation = validateTaskRequest(body.task);
      if (!validation.ok || validation.task.type !== "content.review" ||
          validation.task.payload.articlePath !== "articles/ai-agent-thuc-hanh-tu-thiet-ke-den-kiem-soat.html" ||
          !validation.task.idempotencyKey.startsWith("oidc-preview-e2e:")) {
        return json({ ok: false, error: "oidc_run_task_not_allowlisted" }, 400);
      }

      const authorization = request.headers.get("authorization") || "";
      const tokenMatch = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!tokenMatch || tokenMatch[1].length > 16384) {
        return json({ ok: false, error: "github_oidc_token_required" }, 401);
      }
      const expected = {
        audience: env.AGENT_OIDC_AUDIENCE,
        repository: env.AGENT_OIDC_REPOSITORY,
        repositoryOwner: env.AGENT_OIDC_REPOSITORY_OWNER,
        repositoryId: env.AGENT_OIDC_REPOSITORY_ID,
        repositoryOwnerId: env.AGENT_OIDC_REPOSITORY_OWNER_ID,
        ref: env.AGENT_OIDC_RUN_REF,
        workflowRef: env.AGENT_OIDC_RUN_WORKFLOW_REF,
        actorId: env.AGENT_OIDC_RUN_ACTOR_ID,
        eventName: "pull_request",
        environment: "agent-runtime-preview",
      };
      if (!Object.entries(expected).every(([key, value]) =>
        typeof value === "string" && value.length > 0 && value.length <= (key === "workflowRef" ? 512 : 256)) ||
        !/^\d{1,20}$/.test(expected.actorId) ||
        !/^\d{1,20}$/.test(expected.repositoryId) ||
        !/^\d{1,20}$/.test(expected.repositoryOwnerId)) {
        return json({ ok: false, error: "github_oidc_run_policy_unconfigured" }, 503);
      }
      const authorized = await authorizeGitHubActionsOperator(tokenMatch[1], { env, expected });
      if (!authorized.ok) {
        if (authorized.error === "oidc_token_replayed") return json({ ok: false, error: "github_oidc_token_replayed" }, 409);
        if (authorized.error?.includes("unavailable") || authorized.error === "oidc_replay_response_invalid") {
          return json({ ok: false, error: "github_oidc_verification_unavailable" }, 503);
        }
        return json({ ok: false, error: "github_oidc_token_invalid" }, 401);
      }

      // Capture aggregate audit counters before the single task so persistence
      // can be checked without exposing the State Store binding publicly.
      let beforeMetrics;
      try {
        beforeMetrics = await readStateStore(env, "/metrics");
      } catch {
        return json({ ok: false, error: "oidc_run_audit_unavailable" }, 503);
      }

      // Resume the Durable Object's independent admission latch only after exact
      // GitHub OIDC authorization. This route is task- and workflow-allowlisted,
      // and the latch is paused again in finally before any result is returned.
      const actor = "github-actions:" + authorized.identity.actorId;
      const requestId = () => crypto.randomUUID();
      let response = null;
      let pauseVerified = false;
      try {
        await writeStateStore(env, "/control/resume", {
          actor,
          requestId: requestId(),
          reason: "one-shot OIDC Preview E2E",
        });

        // The private symbol cannot be supplied by an HTTP caller. It authorizes
        // exactly this in-process handoff to the existing leased /run implementation.
        const runResponse = await worker.fetch(new Request("https://agent-runtime.internal/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: [validation.task] }),
        }), env, INTERNAL_OIDC_RUN);
        if (!runResponse.ok) {
          response = runResponse;
        } else {
          let runResult;
          try {
            runResult = await readBoundedJson(runResponse);
          } catch {
            response = json({ ok: false, error: "oidc_run_result_invalid" }, 503);
          }
          if (response === null) {
            const item = runResult?.items?.[0];
            if (runResult?.ok !== true || runResult?.summary?.total !== 1 ||
                runResult?.summary?.succeeded !== 1 || item?.state !== "succeeded" ||
                typeof item.taskId !== "string" || item.result?.taskType !== "content.review") {
              const diagnosticCode = isSafeOidcDiagnosticCode(item?.diagnosticCode)
                ? item.diagnosticCode : undefined;
              response = json({ ok: false, error: "oidc_run_not_succeeded",
                ...(diagnosticCode ? { diagnosticCode } : {}) }, 503);
            } else {
              try {
                const persisted = await readStateStore(env, "/task?id=" + encodeURIComponent(item.taskId));
                const afterMetrics = await readStateStore(env, "/metrics");
                const eventTypes = ["task.queued", "task.claimed", "task.succeeded"];
                const count = (metrics, eventType) => {
                  const entry = Array.isArray(metrics?.auditLast24h)
                    ? metrics.auditLast24h.find((event) => event?.eventType === eventType)
                    : null;
                  return Number.isSafeInteger(entry?.count) && entry.count >= 0 ? entry.count : 0;
                };
                const auditEvents = Object.fromEntries(eventTypes.map((eventType) => [
                  eventType,
                  { before: count(beforeMetrics, eventType), after: count(afterMetrics, eventType) },
                ]));
                const auditVerified = eventTypes.every((eventType) =>
                  auditEvents[eventType].after >= auditEvents[eventType].before + 1);
                if (persisted?.task?.taskId !== item.taskId || persisted.task.state !== "succeeded" ||
                    persisted.task.type !== "content.review" || !persisted.task.result ||
                    persisted.task.result.taskType !== "content.review" || !auditVerified) {
                  response = json({ ok: false, error: "oidc_run_persistence_verification_failed" }, 503);
                } else {
                  response = json({
                    ...runResult,
                    persistence: {
                      verified: true,
                      taskId: item.taskId,
                      state: persisted.task.state,
                      auditEvents,
                    },
                  });
                }
              } catch {
                response = json({ ok: false, error: "oidc_run_persistence_verification_unavailable" }, 503);
              }
            }
          }
        }
      } catch {
        response = json({ ok: false, error: "oidc_run_execution_unavailable" }, 503);
      } finally {
        // Always close the durable admission latch, including when reserve,
        // claim, heartbeat, execution, or persistence verification fails.
        try {
          await writeStateStore(env, "/control/pause", {
            actor,
            requestId: requestId(),
            reason: "one-shot OIDC Preview E2E complete",
          });
          const control = await readStateStore(env, "/control");
          pauseVerified = control?.control?.paused === true;
        } catch {
          pauseVerified = false;
        }
      }
      if (!pauseVerified) return json({ ok: false, error: "oidc_run_pause_verification_failed" }, 503);
      return response ?? json({ ok: false, error: "oidc_run_result_unavailable" }, 503);
    }
    if (url.pathname === "/internal/oidc/pause") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (env.AGENT_OIDC_ENABLED !== "true") return json({ ok: false, error: "oidc_operator_disabled" }, 503);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);

      const parsedBody = await readBoundedJsonValueRequest(request, 1024);
      if (!parsedBody.ok) {
        return json({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
      }
      const body = parsedBody.value;
      if (body === null || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "reason") ||
          (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 160 ||
            [...body.reason].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)))) {
        return json({ ok: false, error: "request_invalid" }, 400);
      }

      const authorization = request.headers.get("authorization") || "";
      const tokenMatch = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!tokenMatch || tokenMatch[1].length > 16384) return json({ ok: false, error: "github_oidc_token_required" }, 401);

      const expected = {
        audience: env.AGENT_OIDC_AUDIENCE,
        repository: env.AGENT_OIDC_REPOSITORY,
        repositoryOwner: env.AGENT_OIDC_REPOSITORY_OWNER,
        repositoryId: env.AGENT_OIDC_REPOSITORY_ID,
        repositoryOwnerId: env.AGENT_OIDC_REPOSITORY_OWNER_ID,
        ref: env.AGENT_OIDC_REF,
        workflowRef: env.AGENT_OIDC_WORKFLOW_REF,
        actorId: env.AGENT_OIDC_ACTOR_ID,
        eventName: "workflow_dispatch",
      };
      if (!Object.entries(expected).every(([key, value]) =>
        typeof value === "string" && value.length > 0 && value.length <= (key === "workflowRef" ? 512 : 256)) ||
        !/^\d{1,20}$/.test(expected.actorId) ||
        !/^\d{1,20}$/.test(expected.repositoryId) ||
        !/^\d{1,20}$/.test(expected.repositoryOwnerId)) {
        return json({ ok: false, error: "github_oidc_policy_unconfigured" }, 503);
      }
      const authorized = await authorizeGitHubActionsOperator(tokenMatch[1], { env, expected });
      if (!authorized.ok) {
        if (authorized.error === "oidc_token_replayed") return json({ ok: false, error: "github_oidc_token_replayed" }, 409);
        if (authorized.error?.includes("unavailable") || authorized.error === "oidc_replay_response_invalid") {
          return json({ ok: false, error: "github_oidc_verification_unavailable" }, 503);
        }
        return json({ ok: false, error: "github_oidc_token_invalid" }, 401);
      }

      const actor = "github-actions:" + authorized.identity.actorId;
      try {
        const result = await writeStateStore(env, "/control/pause", {
          actor,
          requestId: crypto.randomUUID(),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        });
        return json({ ok: true, changed: result.changed, control: result.control });
      } catch (error) {
        if (error?.status === 429) return json({ ok: false, error: "rate_limited" }, 429);
        return json({ ok: false, error: "control_unavailable" }, 503);
      }
    }
    if (url.pathname === "/internal/oidc/ai-bank-cursor") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (env.AGENT_AI_BANK_INGESTION_ENABLED !== "true") {
        return json({ ok: false, error: "ai_bank_ingestion_disabled" }, 503);
      }
      if (env.AGENT_OIDC_ENABLED !== "true") return json({ ok: false, error: "oidc_operator_disabled" }, 503);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
        return json({ ok: false, error: "json_content_type_required" }, 415);
      }
      const parsedBody = await readBoundedJsonValueRequest(request, 256);
      if (!parsedBody.ok) return json({ ok: false, error: "request_invalid" }, parsedBody.status);
      if (!parsedBody.value || typeof parsedBody.value !== "object" || Array.isArray(parsedBody.value) ||
          Object.keys(parsedBody.value).length !== 0) {
        return json({ ok: false, error: "ai_bank_cursor_request_invalid" }, 400);
      }
      const authorization = request.headers.get("authorization") || "";
      const tokenMatch = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!tokenMatch || tokenMatch[1].length > 16384) return json({ ok: false, error: "github_oidc_token_required" }, 401);
      const expected = {
        audience: env.AGENT_OIDC_AUDIENCE,
        repository: env.AGENT_OIDC_REPOSITORY,
        repositoryOwner: env.AGENT_OIDC_REPOSITORY_OWNER,
        repositoryId: env.AGENT_OIDC_REPOSITORY_ID,
        repositoryOwnerId: env.AGENT_OIDC_REPOSITORY_OWNER_ID,
        ref: env.AGENT_OIDC_REF,
        workflowRef: env.AGENT_AI_BANK_OIDC_WORKFLOW_REF,
        actorId: env.AGENT_OIDC_ACTOR_ID,
        eventName: "workflow_dispatch",
      };
      if (!Object.entries(expected).every(([key, value]) =>
        typeof value === "string" && value.length > 0 && value.length <= (key === "workflowRef" ? 512 : 256)) ||
        !/^\d{1,20}$/.test(expected.actorId) ||
        !/^\d{1,20}$/.test(expected.repositoryId) ||
        !/^\d{1,20}$/.test(expected.repositoryOwnerId)) {
        return json({ ok: false, error: "github_oidc_policy_unconfigured" }, 503);
      }
      const authorized = await authorizeGitHubActionsOperator(tokenMatch[1], { env, expected });
      if (!authorized.ok) {
        if (authorized.error === "oidc_token_replayed") return json({ ok: false, error: "github_oidc_token_replayed" }, 409);
        if (authorized.error?.includes("unavailable") || authorized.error === "oidc_replay_response_invalid") {
          return json({ ok: false, error: "github_oidc_verification_unavailable" }, 503);
        }
        return json({ ok: false, error: "github_oidc_token_invalid" }, 401);
      }
      const namespace = env.AGENT_AI_BANK_CANDIDATE_STORE;
      if (!namespace || typeof namespace.idFromName !== "function") {
        return json({ ok: false, error: "ai_bank_candidate_store_unavailable" }, 503);
      }
      try {
        const stub = namespace.get(namespace.idFromName("ai-bank-discovery-global"));
        if (!stub || typeof stub.getDiscoveryCursor !== "function") {
          return json({ ok: false, error: "ai_bank_candidate_store_unavailable" }, 503);
        }
        const cursor = await stub.getDiscoveryCursor();
        return json({ ok: true, cursor: cursor?.cursor || null, scan_id: cursor?.scan_id || null });
      } catch {
        return json({ ok: false, error: "ai_bank_candidate_store_unavailable" }, 503);
      }
    }

    if (url.pathname === "/internal/oidc/ai-bank-ingest") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (env.AGENT_AI_BANK_INGESTION_ENABLED !== "true") {
        return json({ ok: false, error: "ai_bank_ingestion_disabled" }, 503);
      }
      if (env.AGENT_OIDC_ENABLED !== "true") return json({ ok: false, error: "oidc_operator_disabled" }, 503);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
        return json({ ok: false, error: "json_content_type_required" }, 415);
      }
      const parsedBody = await readBoundedJsonValueRequest(request, 96 * 1024);
      if (!parsedBody.ok) {
        return json({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
      }
      const body = parsedBody.value;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "candidates,cursor,scanId" ||
          !Array.isArray(body.candidates) || body.candidates.length > 10 ||
          typeof body.cursor !== "string" || typeof body.scanId !== "string") {
        return json({ ok: false, error: "ai_bank_ingest_request_invalid" }, 400);
      }

      const authorization = request.headers.get("authorization") || "";
      const tokenMatch = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!tokenMatch || tokenMatch[1].length > 16384) return json({ ok: false, error: "github_oidc_token_required" }, 401);
      const expected = {
        audience: env.AGENT_OIDC_AUDIENCE,
        repository: env.AGENT_OIDC_REPOSITORY,
        repositoryOwner: env.AGENT_OIDC_REPOSITORY_OWNER,
        repositoryId: env.AGENT_OIDC_REPOSITORY_ID,
        repositoryOwnerId: env.AGENT_OIDC_REPOSITORY_OWNER_ID,
        ref: env.AGENT_OIDC_REF,
        workflowRef: env.AGENT_AI_BANK_OIDC_WORKFLOW_REF,
        actorId: env.AGENT_OIDC_ACTOR_ID,
        eventName: "workflow_dispatch",
      };
      if (!Object.entries(expected).every(([key, value]) =>
        typeof value === "string" && value.length > 0 && value.length <= (key === "workflowRef" ? 512 : 256)) ||
        !/^\d{1,20}$/.test(expected.actorId) ||
        !/^\d{1,20}$/.test(expected.repositoryId) ||
        !/^\d{1,20}$/.test(expected.repositoryOwnerId)) {
        return json({ ok: false, error: "github_oidc_policy_unconfigured" }, 503);
      }
      const authorized = await authorizeGitHubActionsOperator(tokenMatch[1], { env, expected });
      if (!authorized.ok) {
        if (authorized.error === "oidc_token_replayed") return json({ ok: false, error: "github_oidc_token_replayed" }, 409);
        if (authorized.error?.includes("unavailable") || authorized.error === "oidc_replay_response_invalid") {
          return json({ ok: false, error: "github_oidc_verification_unavailable" }, 503);
        }
        return json({ ok: false, error: "github_oidc_token_invalid" }, 401);
      }

      const namespace = env.AGENT_AI_BANK_CANDIDATE_STORE;
      if (!namespace || typeof namespace.idFromName !== "function") {
        return json({ ok: false, error: "ai_bank_candidate_store_unavailable" }, 503);
      }
      try {
        const stub = namespace.get(namespace.idFromName("ai-bank-discovery-global"));
        if (!stub || typeof stub.upsertCandidatesAndAdvanceCursor !== "function") {
          return json({ ok: false, error: "ai_bank_candidate_store_unavailable" }, 503);
        }
        const result = await stub.upsertCandidatesAndAdvanceCursor(
          body.candidates, body.cursor, body.scanId, Date.now()
        );
        if (!result || result.accepted !== true) {
          const conflict = ["discovery_cursor_not_monotonic", "discovery_scan_id_reused"].includes(result?.reason);
          return json({ ok: false, error: result?.reason || "ai_bank_candidate_store_rejected",
            cursor_advanced: false, catalog_write_authorized: false,
            public_publication_authorized: false }, conflict ? 409 : 422);
        }
        return json({
          ok: true,
          duplicate: result.duplicate === true,
          inserted: result.inserted,
          updated: result.updated,
          unchanged: result.unchanged,
          total: result.total,
          cursor: result.cursor,
          scan_id: result.scan_id,
          cursor_advanced: result.cursor_advanced === true,
          catalog_modified: false,
          catalog_write_authorized: false,
          public_publication_authorized: false,
        });
      } catch {
        return json({ ok: false, error: "ai_bank_candidate_store_unavailable",
          cursor_advanced: false, catalog_write_authorized: false,
          public_publication_authorized: false }, 503);
      }
    }

    if (url.pathname === "/run") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!isEnabled(env.AGENT_ENABLED) || env.AGENT_PAUSED !== "false") {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }
      if (context !== INTERNAL_OIDC_RUN && !await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      const parsed = await readBoundedJsonValueRequest(request, 16 * 1024);
      if (!parsed.ok) {
        return json({ ok: false, error: parsed.status === 413 ? "request_body_too_large" : "request_invalid" }, parsed.status);
      }
      const body = parsed.value;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !Array.isArray(body.tasks) ||
          body.tasks.length < 1 || body.tasks.length > 5) {
        return json({ ok: false, error: "request_invalid" }, 400);
      }
      try {
        const snapshotAdapter = createReadOnlyTaskSnapshotAdapter(createPreviewReadOnlyReaders());
        const manager = createReadOnlyAgentManager({ snapshotAdapter });
        const items = [];
        for (const task of body.tasks) {
          const reserved = await writeStateStore(env, "/reserve", { task });
          const stored = reserved.task;
          if (!stored || typeof stored.taskId !== "string") {
            throw new Error("state_store_reservation_invalid");
          }
          if (stored.state === "succeeded" || stored.state === "failed" || stored.state === "cancelled") {
            items.push({ ok: stored.state === "succeeded", taskId: stored.taskId, state: stored.state, duplicate: true });
            continue;
          }
          if (stored.state === "running") {
            items.push({ ok: false, taskId: stored.taskId, state: "running", duplicate: true, error: "task_already_running" });
            continue;
          }
          if (stored.state !== "queued") throw new Error("state_store_task_state_invalid");

          let claimed;
          try {
            claimed = await writeStateStore(env, "/claim", { taskId: stored.taskId });
          } catch (error) {
            if (error?.status === 409) {
              items.push({ ok: false, taskId: stored.taskId, state: "queued", error: "task_not_claimable" });
              continue;
            }
            throw error;
          }
          const lease = claimed.lease;
          if (!lease || typeof lease.owner !== "string" || !Number.isSafeInteger(lease.generation)) {
            throw new Error("state_store_lease_invalid");
          }
          const report = await runWithLeaseHeartbeat(
            (signal) => manager.reviewBatch([task], { signal }),
            () => writeStateStore(env, "/heartbeat", {
              taskId: stored.taskId,
              leaseOwner: lease.owner,
              leaseGeneration: lease.generation,
            }),
            LEASE_HEARTBEAT_INTERVAL_MS,
          );
          const item = report.items[0];
          const result = safeReviewResult(item);
          const reviewSucceeded = result.ok === true;
          const completion = await writeStateStore(env, "/complete", {
            taskId: stored.taskId,
            leaseOwner: lease.owner,
            leaseGeneration: lease.generation,
            status: reviewSucceeded ? "succeeded" : "failed",
            ...(reviewSucceeded ? {
              result: {
                taskType: result.taskType,
                status: result.status,
                findingCount: result.findingCount,
                findings: result.findings,
              },
            } : { errorCode: result.errorCode }),
          });
          items.push({
            ok: reviewSucceeded,
            taskId: stored.taskId,
            state: completion.task?.state || (reviewSucceeded ? "succeeded" : "failed"),
            result,
            ...(context === INTERNAL_OIDC_RUN && !reviewSucceeded &&
                isSafeOidcDiagnosticCode(item?.error)
              ? { diagnosticCode: item.error } : {}),
          });
        }
        const summary = {
          total: items.length,
          succeeded: items.filter((item) => item.state === "succeeded").length,
          failed: items.filter((item) => item.state === "failed").length,
          cancelled: items.filter((item) => item.state === "cancelled").length,
          queued: items.filter((item) => item.state === "queued").length,
          running: items.filter((item) => item.state === "running").length,
        };
        return json({
          ok: summary.succeeded === summary.total,
          mode: "operator_triggered_durable_read_only_review",
          execution: "synchronous_leased_read_only_review",
          items,
          summary,
          limitations: [
            "no_scheduler_or_background_execution",
            "seo_live_evidence_unavailable",
            "repository_source_is_public_main_branch",
          ],
        });
      } catch (error) {
        const status = [400, 401, 409, 429, 503].includes(error?.status) ? error.status : 503;
        return json({ ok: false, error: status === 429 ? "runtime_capacity_limited" : "durable_review_unavailable" }, status);
      }
    }

    if (url.pathname === "/internal/authoring/prepare") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!isEnabled(env.AGENT_ENABLED) || env.AGENT_PAUSED !== "false") {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
        return json({ ok: false, error: "json_content_type_required" }, 415);
      }
      const parsed = await readBoundedJsonValueRequest(request, 2048);
      if (!parsed.ok) {
        return json({ ok: false, error: parsed.status === 413 ? "request_body_too_large" : "request_invalid" }, parsed.status);
      }
      const body = parsed.value;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "idempotencyKey,topic" ||
          typeof body.topic !== "string" || body.topic.trim() !== body.topic ||
          body.topic.length < 5 || body.topic.length > 200 ||
          /[\u0000-\u001f\u007f]/.test(body.topic) ||
          typeof body.idempotencyKey !== "string" || !AUTHORING_IDEMPOTENCY_KEY.test(body.idempotencyKey)) {
        return json({ ok: false, error: "authoring_request_invalid" }, 400);
      }

      const provider = selectProvider("content_draft", [{
        id: "article-authoring-brief",
        status: "ready",
        execution_surface: "agent_runtime",
        cost_class: "no_external_execution",
        capabilities: ["content_draft"],
      }]);
      if (provider.action !== "execute" || provider.provider !== "article-authoring-brief") {
        return json({ ok: false, error: "authoring_provider_deferred" }, 503);
      }
      const namespace = env.AGENT_DRAFT_STORE;
      if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
        return json({ ok: false, error: "draft_store_unavailable" }, 503);
      }
      const draftStub = namespace.get(namespace.idFromName("agent-authoring-global"));
      if (!draftStub || typeof draftStub.getDraft !== "function" || typeof draftStub.createDraft !== "function") {
        return json({ ok: false, error: "draft_store_unavailable" }, 503);
      }

      try {
        const artifactId = await authoringArtifactId(body.idempotencyKey, body.topic);
        const existing = await draftStub.getDraft(artifactId);
        if (existing) {
          if (existing.draft?.title !== body.topic.slice(0, 70)) {
            return json({ ok: false, error: "authoring_idempotency_conflict" }, 409);
          }
          const summary = authoringArtifactSummary(existing);
          if (!summary) return json({ ok: false, error: "draft_store_response_invalid" }, 503);
          return json({
            ok: true,
            duplicate: true,
            mode: "operator_triggered_research_to_authoring_brief",
            execution: "local_deterministic_no_external_ai",
            artifact: summary,
            research: { sources_checked: 0, sources_succeeded: 0, signals: 0, evidence_retrieved: 0 },
            claims_generated: false,
            catalog_modified: false,
            publication_authorized: false,
          });
        }

        // Four fixed official feeds; reserve one unit before each outbound request.
        await consumeContentResearchBudget(env, 4);
        const discovery = await discoverResearchSignals({ now: Date.now(), lookbackDays: 14 });
        if (!discovery.ok) return json({ ok: false, error: "research_sources_unavailable" }, 503);
        const signals = Array.isArray(discovery.latest_signals) ? discovery.latest_signals.slice(0, 4) : [];
        if (signals.length === 0) {
          return json({
            ok: true,
            status: "no_fresh_research_signals",
            mode: "operator_triggered_research_to_authoring_brief",
            execution: "local_deterministic_no_external_ai",
            research: { sources_checked: discovery.sources_checked, sources_succeeded: discovery.sources_succeeded, signals: 0, evidence_retrieved: 0 },
            artifact_created: false,
            claims_generated: false,
            catalog_modified: false,
            publication_authorized: false,
          });
        }

        // Reserve only the number of source pages about to be fetched.
        await consumeContentResearchBudget(env, signals.length);
        const retrieval = await retrieveResearchEvidence(signals, { now: Date.now() });
        const evidence = Array.isArray(retrieval.evidence)
          ? retrieval.evidence.filter((item) => item?.status === "source_retrieved_not_fact_checked")
          : [];
        const brief = buildArticleAuthoringBrief({
          topic: body.topic,
          researchEvidence: evidence,
          now: Date.now(),
        });
        if (!brief.prepared || !brief.draft) {
          return json({
            ok: false,
            error: "authoring_brief_blocked",
            reason: brief.reason || "research_evidence_insufficient",
            research: {
              sources_checked: discovery.sources_checked,
              sources_succeeded: discovery.sources_succeeded,
              signals: signals.length,
              evidence_retrieved: evidence.length,
            },
            artifact_created: false,
            claims_generated: false,
            publication_authorized: false,
          }, 422);
        }

        const persisted = await draftStub.createDraft(artifactId, brief.draft, evidence);
        if (!persisted?.accepted || !persisted.artifact) {
          const conflict = persisted?.reason === "artifact_id_conflict";
          return json({ ok: false, error: conflict ? "authoring_idempotency_conflict" : "draft_persistence_rejected" }, conflict ? 409 : 422);
        }
        const summary = authoringArtifactSummary(persisted.artifact);
        if (!summary) return json({ ok: false, error: "draft_store_response_invalid" }, 503);
        return json({
          ok: true,
          duplicate: persisted.duplicate === true,
          mode: "operator_triggered_research_to_authoring_brief",
          execution: "local_deterministic_no_external_ai",
          artifact: summary,
          research: {
            sources_checked: discovery.sources_checked,
            sources_succeeded: discovery.sources_succeeded,
            signals: signals.length,
            evidence_retrieved: evidence.length,
          },
          claims_generated: false,
          catalog_modified: false,
          publication_authorized: false,
          limitations: [
            "human_authorship_required",
            "source_excerpts_not_fact_checked_or_corroborated",
            "no_ai_inference_or_paid_provider",
            "no_catalog_or_publication_write",
            "manual_operator_trigger_only",
          ],
        });
      } catch (error) {
        if (error?.status === 429) return json({ ok: false, error: "research_budget_exhausted" }, 429);
        if (error?.status === 400) return json({ ok: false, error: "research_budget_exhausted_or_invalid" }, 429);
        return json({ ok: false, error: "authoring_preparation_unavailable" }, 503);
      }
    }

    if (url.pathname === "/internal/enqueue") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!isEnabled(env.AGENT_ENABLED) || env.AGENT_PAUSED !== "false") {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      const parsed = await readBoundedJsonValueRequest(request, 16 * 1024);
      if (!parsed.ok) {
        return json({ ok: false, error: parsed.status === 413 ? "request_body_too_large" : "request_invalid" }, parsed.status);
      }
      const body = parsed.value;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !Array.isArray(body.tasks) ||
          body.tasks.length < 1 || body.tasks.length > 5) {
        return json({ ok: false, error: "request_invalid" }, 400);
      }
      const items = [];
      for (const task of body.tasks) {
        try {
          const reserved = await writeStateStore(env, "/reserve", { task });
          if (!reserved.task || typeof reserved.task.taskId !== "string") {
            return json({ ok: false, error: "queue_admission_unavailable", items }, 503);
          }
          items.push({
            ok: true,
            taskId: reserved.task.taskId,
            state: reserved.task.state,
            duplicate: reserved.duplicate === true,
          });
        } catch (error) {
          const status = [400, 401, 409, 429, 503].includes(error?.status) ? error.status : 503;
          return json({
            ok: false,
            error: status === 429 ? "runtime_capacity_limited" :
              status === 400 ? "task_request_invalid" : "queue_admission_unavailable",
            items,
          }, status);
        }
      }
      return json({
        ok: true,
        mode: "operator_triggered_queue_admission",
        execution: "not_started",
        items,
        summary: {
          submitted: items.length,
          newlyQueued: items.filter((item) => !item.duplicate && item.state === "queued").length,
          duplicates: items.filter((item) => item.duplicate).length,
        },
        limitations: [
          "admission_only_no_task_execution",
          "manual_operator_dispatch_required",
          "no_scheduler_or_background_execution",
          "read_only_review_handlers_only",
        ],
      });
    }
    if (url.pathname === "/internal/dispatch") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!isEnabled(env.AGENT_ENABLED) || env.AGENT_PAUSED !== "false") {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      const parsed = await readBoundedJsonValueRequest(request, 1024);
      if (!parsed.ok) {
        return json({ ok: false, error: parsed.status === 413 ? "request_body_too_large" : "request_invalid" }, parsed.status);
      }
      const body = parsed.value;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "maxTasks") ||
          (body.maxTasks !== undefined && (!Number.isSafeInteger(body.maxTasks) || body.maxTasks < 1 || body.maxTasks > 5))) {
        return json({ ok: false, error: "request_invalid" }, 400);
      }
      const maxTasks = body.maxTasks ?? 1;
      try {
        const snapshotAdapter = createReadOnlyTaskSnapshotAdapter(createPreviewReadOnlyReaders());
        const manager = createReadOnlyAgentManager({ snapshotAdapter });
        const items = [];
        for (let index = 0; index < maxTasks; index++) {
          const claimed = await writeStateStore(env, "/claim-next", {});
          if (!claimed.task) break;
          const task = claimed.task;
          const lease = claimed.lease;
          if (!task || typeof task.taskId !== "string" ||
              !lease || typeof lease.owner !== "string" || !Number.isSafeInteger(lease.generation)) {
            throw new Error("state_store_claim_invalid");
          }
          const report = await runWithLeaseHeartbeat(
            (signal) => manager.reviewBatch([{
              type: task.type,
              idempotencyKey: task.idempotencyKey,
              payload: task.payload,
            }], { signal }),
            () => writeStateStore(env, "/heartbeat", {
              taskId: task.taskId,
              leaseOwner: lease.owner,
              leaseGeneration: lease.generation,
            }),
            LEASE_HEARTBEAT_INTERVAL_MS,
          );
          const item = report.items[0];
          const result = safeReviewResult(item);
          const reviewSucceeded = result.ok === true;
          const completion = await writeStateStore(env, "/complete", {
            taskId: task.taskId,
            leaseOwner: lease.owner,
            leaseGeneration: lease.generation,
            status: reviewSucceeded ? "succeeded" : "failed",
            ...(reviewSucceeded ? {
              result: {
                taskType: result.taskType,
                status: result.status,
                findingCount: result.findingCount,
                findings: result.findings,
              },
            } : { errorCode: result.errorCode }),
          });
          items.push({
            ok: reviewSucceeded,
            taskId: task.taskId,
            state: completion.task?.state || (reviewSucceeded ? "succeeded" : "failed"),
            result,
          });
        }
        const summary = {
          requested: maxTasks,
          processed: items.length,
          succeeded: items.filter((item) => item.state === "succeeded").length,
          failed: items.filter((item) => item.state === "failed").length,
        };
        return json({
          ok: summary.failed === 0,
          mode: "operator_triggered_bounded_queue_dispatch",
          execution: "synchronous_leased_read_only_review",
          items,
          summary,
          limitations: [
            "manual_operator_trigger_only",
            "no_scheduler_or_background_execution",
            "seo_live_evidence_unavailable",
          ],
        });
      } catch {
        return json({ ok: false, error: "queue_dispatch_unavailable" }, 503);
      }
    }
    if (url.pathname === "/internal/control") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      try {
        const result = await readStateStore(env, "/control");
        return json({ ok: true, control: result.control });
      } catch {
        return json({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    if (url.pathname === "/internal/control/pause" || url.pathname === "/internal/control/resume") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      const actor = env.AGENT_OPERATOR_ID;
      if (typeof actor !== "string" || !/^[a-zA-Z0-9._:-]{3,64}$/.test(actor)) {
        return json({ ok: false, error: "operator_identity_unavailable" }, 503);
      }
      const parsedBody = await readBoundedControlJson(request, 1024);
      if (!parsedBody.ok) {
        return json({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
      }
      const body = parsedBody.value;
      if (body === null || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "reason") ||
          (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 160 ||
            [...body.reason].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)))) {
        return json({ ok: false, error: "request_invalid" }, 400);
      }
      const action = url.pathname.endsWith("/pause") ? "pause" : "resume";
      try {
        const result = await writeStateStore(env, "/control/" + action, {
          actor,
          requestId: crypto.randomUUID(),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        });
        return json({ ok: true, changed: result.changed, control: result.control });
      } catch (error) {
        if ([400, 401, 409, 429, 503].includes(error?.status)) {
          return json({ ok: false, error: error.status === 429 ? "rate_limited" : "control_unavailable" }, error.status);
        }
        return json({ ok: false, error: "control_unavailable" }, 503);
      }
    }
    if (url.pathname === "/internal/recover") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      if (env.AGENT_ENABLED !== "true" || env.AGENT_PAUSED !== "false") {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }
      const actor = env.AGENT_OPERATOR_ID;
      if (typeof actor !== "string" || !/^[a-zA-Z0-9._:-]{3,64}$/.test(actor)) {
        return json({ ok: false, error: "operator_identity_unavailable" }, 503);
      }
      const parsedBody = await readBoundedJsonValueRequest(request, 1024);
      if (!parsedBody.ok) {
        return json({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
      }
      const body = parsedBody.value;
      if (body === null || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || typeof body.taskId !== "string" ||
          body.taskId.length < 1 || body.taskId.length > 64 ||
          [...body.taskId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
        return json({ ok: false, error: "request_invalid" }, 400);
      }
      try {
        const result = await writeStateStore(env, "/recover", {
          taskId: body.taskId,
          actor,
          requestId: crypto.randomUUID(),
        });
        const task = result.task;
        if (!task || typeof task.taskId !== "string") {
          return json({ ok: false, error: "state_store_response_invalid" }, 503);
        }
        return json({ ok: true, outcome: result.outcome, task: {
          taskId: task.taskId, type: task.type, state: task.state,
          attemptCount: task.attemptCount, maxAttempts: task.maxAttempts,
          nextAttemptAt: task.nextAttemptAt, lastErrorCode: task.lastErrorCode,
          result: task.result ?? null,
        } });
      } catch (error) {
        if (error?.status === 404) return json({ ok: false, error: "task_not_found" }, 404);
        if (error?.status === 409) return json({ ok: false, error: "task_recovery_conflict" }, 409);
        if (error?.status === 429) return json({ ok: false, error: "rate_limited" }, 429);
        return json({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    if (url.pathname === "/internal/usage" || url.pathname === "/internal/metrics" ||
        url.pathname === "/internal/task" || url.pathname === "/internal/dead-letter") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      let pathname;
      if (url.pathname === "/internal/usage" || url.pathname === "/internal/metrics") {
        if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
        pathname = url.pathname === "/internal/metrics" ? "/metrics" : "/usage";
      } else if (url.pathname === "/internal/dead-letter") {
        const allowed = new Set(["limit", "beforeTerminalAt", "beforeTaskId"]);
        const keys = [...url.searchParams.keys()];
        if (keys.some((key) => !allowed.has(key)) ||
            keys.some((key) => url.searchParams.getAll(key).length !== 1) ||
            (url.searchParams.has("beforeTerminalAt") !== url.searchParams.has("beforeTaskId"))) {
          return json({ ok: false, error: "request_invalid" }, 400);
        }
        const limitText = url.searchParams.get("limit") ?? "25";
        if (!/^\d{1,2}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 50) {
          return json({ ok: false, error: "request_invalid" }, 400);
        }
        const query = new URLSearchParams({ limit: limitText });
        if (url.searchParams.has("beforeTerminalAt")) {
          const timestamp = url.searchParams.get("beforeTerminalAt");
          const taskId = url.searchParams.get("beforeTaskId");
          if (!/^\d{1,16}$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) ||
              Number(timestamp) < 0 || !taskId || taskId.length > 64 ||
              [...taskId].some((character) => character.charCodeAt(0) < 33 || character.charCodeAt(0) === 127)) {
            return json({ ok: false, error: "request_invalid" }, 400);
          }
          query.set("beforeTerminalAt", timestamp);
          query.set("beforeTaskId", taskId);
        }
        pathname = "/dead-letter?" + query.toString();
      } else {
        const taskId = url.searchParams.get("id");
        if (!taskId || taskId.length > 64 || url.searchParams.getAll("id").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "id")) {
          return json({ ok: false, error: "task_id_invalid" }, 400);
        }
        pathname = "/task?id=" + encodeURIComponent(taskId);
      }
      try {
        const result = await readStateStore(env, pathname);
        if (url.pathname === "/internal/usage") {
          const budgetDay = currentUtcBudgetDay();
          const externalBudgets = await Promise.all(
            ["ai_bank_discovery", "content_research"].map(async (scope) => {
              const snapshot = await readStateStore(
                env,
                "/external-budget?day=" + budgetDay + "&scope=" + scope,
              );
              const budget = snapshot?.budget;
              if (!budget || budget.ok !== true || budget.day !== budgetDay ||
                  budget.scope !== scope || !Number.isSafeInteger(budget.used) || budget.used < 0 ||
                  !Number.isSafeInteger(budget.limit) || budget.limit < 1 ||
                  !Number.isSafeInteger(budget.remaining) || budget.remaining < 0 ||
                  budget.used + budget.remaining !== budget.limit) {
                throw new Error("state_store_budget_response_invalid");
              }
              return {
                day: budget.day,
                scope: budget.scope,
                used: budget.used,
                limit: budget.limit,
                remaining: budget.remaining,
              };
            }),
          );
          return json({
            ok: true, dayUtc: budgetDay,
            acceptedToday: result.acceptedToday, inFlight: result.inFlight,
            externalBudgets,
          });
        }
        if (url.pathname === "/internal/dead-letter") {
          const requestedLimit = Number(url.searchParams.get("limit") ?? "25");
          const validNullableCode = (value) => value === null || (typeof value === "string" && value.length > 0 && value.length <= 64);
          const validClassification = (value) => value &&
            ["transient", "authentication", "configuration", "data", "unknown"].includes(value.category) &&
            ["high", "low"].includes(value.confidence) &&
            ["inspect_provider_or_network_health", "verify_credentials_and_scopes", "review_runtime_configuration", "inspect_input_and_schema", "manual_review"].includes(value.recommendedAction);
          if (!Array.isArray(result.items) || result.items.length > requestedLimit ||
              !(result.nextCursor === null || (result.nextCursor && Number.isSafeInteger(result.nextCursor.terminalAt) &&
                result.nextCursor.terminalAt >= 0 && typeof result.nextCursor.taskId === "string" &&
                result.nextCursor.taskId.length > 0 && result.nextCursor.taskId.length <= 64)) ||
              !result.items.every((item) => item && typeof item.taskId === "string" &&
                item.taskId.length > 0 && item.taskId.length <= 64 &&
                typeof item.type === "string" && item.type.length > 0 && item.type.length <= 64 &&
                Number.isSafeInteger(item.createdAt) && item.createdAt >= 0 &&
                Number.isSafeInteger(item.terminalAt) && item.terminalAt >= 0 &&
                validNullableCode(item.errorCode) && validNullableCode(item.lastErrorCode) &&
                validClassification(item.classification) &&
                Number.isSafeInteger(item.attemptCount) && item.attemptCount >= 0 &&
                Number.isSafeInteger(item.maxAttempts) && item.maxAttempts >= 1 && item.maxAttempts <= 5)) {
            return json({ ok: false, error: "state_store_response_invalid" }, 503);
          }
          const items = result.items.map((item) => ({
            taskId: item.taskId, type: item.type, createdAt: item.createdAt,
            terminalAt: item.terminalAt, errorCode: item.errorCode,
            lastErrorCode: item.lastErrorCode, classification: item.classification,
            attemptCount: item.attemptCount, maxAttempts: item.maxAttempts,
          }));
          const last = items[items.length - 1];
          const nextCursor = result.nextCursor && last &&
            result.nextCursor.terminalAt === last.terminalAt &&
            result.nextCursor.taskId === last.taskId
            ? { terminalAt: last.terminalAt, taskId: last.taskId }
            : null;
          if (result.nextCursor !== null && nextCursor === null) {
            return json({ ok: false, error: "state_store_response_invalid" }, 503);
          }
          return json({ ok: true, items, nextCursor });
        }
        if (url.pathname === "/internal/metrics") {
          const taskFields = ["totalRetained", "queued", "queuedDue", "running", "succeededRetained", "failedRetained", "cancelledRetained", "failedLast24h"];
          const quotaFields = ["acceptedToday", "dailyLimit", "dailyUtilizationPercent", "dailyPressure", "inFlight", "concurrentLimit", "concurrentUtilizationPercent", "concurrentPressure", "overallPressure", "payloadLimitBytes"];
          const circuitFields = ["failureCountLast10m", "threshold", "windowMs"];
          const validPressure = (value) => ["normal", "warning", "critical", "exhausted"].includes(value);
          const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
          const validPercent = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
          const validAge = (value) => value === null || validCount(value);
          if (!result.tasks || !result.quota || !result.circuitBreaker || !Array.isArray(result.auditLast24h) ||
              !Number.isSafeInteger(result.observedAt) ||
              typeof result.dayUtc !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(result.dayUtc) ||
              typeof result.note !== "string" ||
              !taskFields.every((field) => validCount(result.tasks[field])) ||
              !circuitFields.every((field) => validCount(result.circuitBreaker[field])) ||
              typeof result.circuitBreaker.paused !== "boolean" || typeof result.circuitBreaker.autoPaused !== "boolean" ||
              !["open", "closed"].includes(result.circuitBreaker.state) ||
              result.circuitBreaker.autoPaused !== (result.circuitBreaker.state === "open") ||
              !validAge(result.tasks.oldestQueuedAgeMs) || !validAge(result.tasks.oldestRunningUpdateAgeMs) ||
              !["dailyUtilizationPercent", "concurrentUtilizationPercent"].every((field) => validPercent(result.quota[field])) ||
              !["dailyPressure", "concurrentPressure", "overallPressure"].every((field) => validPressure(result.quota[field])) ||
              !["acceptedToday", "dailyLimit", "inFlight", "concurrentLimit", "payloadLimitBytes"].every((field) => validCount(result.quota[field])) ||
              result.auditLast24h.length > 20 ||
              !result.auditLast24h.every((event) => event && typeof event.eventType === "string" &&
                event.eventType.length > 0 && event.eventType.length <= 64 && validCount(event.count))) {
            return json({ ok: false, error: "state_store_response_invalid" }, 503);
          }
          return json({
            ok: true,
            observedAt: result.observedAt,
            dayUtc: result.dayUtc,
            tasks: Object.fromEntries([...taskFields, "oldestQueuedAgeMs", "oldestRunningUpdateAgeMs"].map((field) => [field, result.tasks[field]])),
            quota: Object.fromEntries(quotaFields.map((field) => [field, result.quota[field]])),
            circuitBreaker: Object.fromEntries([...circuitFields, "state", "autoPaused", "paused"].map((field) => [field, result.circuitBreaker[field]])),
            auditLast24h: result.auditLast24h.map((event) => ({ eventType: event.eventType, count: event.count })),
            note: result.note.slice(0, 240),
          });
        }
        const task = result.task;
        if (!task || typeof task.taskId !== "string") return json({ ok: false, error: "state_store_response_invalid" }, 503);
        return json({ ok: true, task: {
          taskId: task.taskId, type: task.type, state: task.state,
          createdAt: task.createdAt, updatedAt: task.updatedAt,
          attemptCount: task.attemptCount, maxAttempts: task.maxAttempts,
          nextAttemptAt: task.nextAttemptAt, lastErrorCode: task.lastErrorCode,
          result: task.result ?? null,
        } });
      } catch (error) {
        if (error?.status === 404) return json({ ok: false, error: "task_not_found" }, 404);
        return json({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    return json({ ok: false, error: "not_found" }, 404);
  },
  async scheduled(controller, env, ctx) {
    // The handler is dormant unless an environment explicitly declares a
    // matching Cron trigger; the checked-in Preview config currently declares none.
    // All gates remain fail-closed; one due task maximum per tick.
    if (controller?.cron !== "*/30 * * * *" ||
        env.AGENT_SCHEDULER_ENABLED !== "true" ||
        env.AGENT_RECOVERY_ALARM_ENABLED !== "true" ||
        env.AGENT_ENABLED !== "true" || env.AGENT_PAUSED !== "false") return;
    const token = env.AGENT_OPERATOR_TOKEN;
    if (typeof token !== "string" || token.length < 32 || token.length > 512) return;
    const request = new Request("https://agent-runtime-scheduler.internal/internal/dispatch", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxTasks: 1 }),
    });
    try {
      const response = await worker.fetch(request, env, INTERNAL_SCHEDULED_DISPATCH);
      if (!response.ok) console.warn("Agent Runtime scheduled tick deferred", response.status);
    } catch {
      // No retry loop or alarm is created here. The next scheduled tick retries
      // admission; the durable lease/recovery policy remains authoritative.
      console.warn("Agent Runtime scheduled tick unavailable");
    }
  },
};
export default worker;
