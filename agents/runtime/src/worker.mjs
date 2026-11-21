import { hasValidOperatorBearer } from "./operator-auth.mjs";
import { hasValidStateStoreBearer } from "./internal-auth.mjs";
import { readBoundedJson as readBoundedJsonBody, readBoundedText } from "./bounded-json-body.mjs";
import { handleReviewerHttpRequest } from "./reviewer-http-routes.mjs";
import { authorizeGitHubActionsOperator } from "./github-oidc-authorize.mjs";
import { createReadOnlyAgentManager } from "./read-only-agent-manager.mjs";
import { createReadOnlyTaskSnapshotAdapter } from "./task-snapshot-adapters.mjs";
import { createPreviewReadOnlyReaders } from "./preview-read-only-sources.mjs";
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
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}
function isEnabled(value) { return value === "true"; }

const SAFE_TASK_TYPES = new Set(["content.review", "ai_bank.candidate_review", "seo.audit"]);
function safeReviewResult(item) {
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
        finding.message.trim() !== finding.message || /[\\u0000-\\u001f\\u007f]/.test(finding.message)) {
      return { ok: false, errorCode: "read_only_review_failed" };
    }
    findings.push({ code: finding.code, severity: finding.severity, message: finding.message });
  }
  return {
    ok: true,
    taskType: item.taskType,
    status: item.status,
    findingCount: item.findingCount,
    findings,
  };
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

const worker = {
  async fetch(request, env = {}, context) {
    if (context !== INTERNAL_SCHEDULED_DISPATCH) {
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
        execution: "operator_triggered_read_only_analysis",
      });
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
    if (url.pathname === "/run") {
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
          });
        }
        const summary = {
          total: items.length,
          succeeded: items.filter((item) => item.state === "succeeded").length,
          failed: items.filter((item) => item.state === "failed").length,
          queued: items.filter((item) => item.state === "queued").length,
          running: items.filter((item) => item.state === "running").length,
        };
        return json({
          ok: summary.failed === 0 && summary.queued === 0 && summary.running === 0,
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
    if (url.pathname === "/internal/usage" || url.pathname === "/internal/task") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      let pathname;
      if (url.pathname === "/internal/usage") {
        if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
        pathname = "/usage";
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
          return json({
            ok: true, dayUtc: result.dayUtc,
            acceptedToday: result.acceptedToday, inFlight: result.inFlight,
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
