import worker, { AgentStateStore, AgentDraftStore } from "../src/worker.mjs";
export { AgentDraftStore };
import { hasValidStateStoreBearer } from "../src/internal-auth.mjs";
import { authorizeGitHubActionsOperator } from "../src/github-oidc-authorize.mjs";

const TARGET_ARTICLE_URL =
  "https://raw.githubusercontent.com/manhdungub-boop/ai-thuc-chien-blog/main/articles/ai-agent-thuc-hanh-tu-thiet-ke-den-kiem-soat.html";
const GATE_TIMEOUT_MS = 120_000;
const PAUSE_REASON = "Adapter pause E2E: independent OIDC workflow";
let runtimeEnv;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function stateStoreRequest(env, pathname, body) {
  const namespace = env.AGENT_STATE_STORE;
  const token = env.AGENT_STATE_STORE_TOKEN;
  if (!namespace || typeof namespace.idFromName !== "function" ||
      typeof namespace.get !== "function" || typeof token !== "string") {
    throw new Error("pause_e2e_state_store_unavailable");
  }
  const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
  const response = await stub.fetch(new Request("https://state-store.internal" + pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok || result?.ok !== true) {
    throw Object.assign(new Error("pause_e2e_state_store_request_failed"), { status: response.status });
  }
  return result;
}

async function recordGateState(state) {
  await stateStoreRequest(runtimeEnv, "/__e2e/gate-state", { state });
}

function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    if (!signal || typeof signal.addEventListener !== "function") {
      reject(new Error("pause_e2e_gate_abort_signal_required"));
      return;
    }
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("pause_e2e_gate_timeout"));
    }, GATE_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

// The real Preview source reader has an 8-second local timeout, shorter than
// the lease heartbeat interval. Extend only that exact timer in this test-only
// Worker so an independent Pause can fence the live lease before source timeout.
const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
globalThis.setTimeout = (callback, delay, ...args) => {
  const adjustedDelay = runtimeEnv?.AGENT_PAUSE_E2E_GATE_ENABLED === "true" && delay === 8_000
    ? 45_000
    : delay;
  return originalSetTimeout(callback, adjustedDelay, ...args);
};

// Test-only interception of exactly one public, read-only GitHub article fetch.
// The production Worker entrypoint never imports this module. The real Preview
// reader receives the original AbortSignal and must unwind after independent Pause.
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init = {}) => {
  let target;
  try {
    target = input instanceof Request
      ? new URL(input.url)
      : input instanceof URL
        ? input
        : new URL(input);
  } catch {
    return originalFetch(input, init);
  }

  if (runtimeEnv?.AGENT_PAUSE_E2E_GATE_ENABLED === "true" &&
      target.href === TARGET_ARTICLE_URL) {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    await recordGateState("entered");
    try {
      await waitForAbort(signal);
      if (!signal.aborted) throw new Error("pause_e2e_gate_released_without_abort");
      await recordGateState("aborted");
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("task_execution_aborted");
    } catch (error) {
      if (!signal?.aborted) await recordGateState("timeout");
      throw error;
    }
  }

  return originalFetch(input, init);
};

export class PauseE2EAgentStateStore extends AgentStateStore {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/__e2e/gate-state") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!await hasValidStateStoreBearer(request, this.env)) {
        return json({ ok: false, error: "state_store_auth_required" }, 401);
      }
      await this.ready;
      let body;
      try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 ||
          !["entered", "aborted", "timeout"].includes(body.state)) {
        return json({ ok: false, error: "gate_state_invalid" }, 400);
      }
      await this.ctx.storage.put("pause-e2e-gate-state", body.state);
      return json({ ok: true, state: body.state });
    }

    if (url.pathname === "/__e2e/task-status") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!await hasValidStateStoreBearer(request, this.env)) {
        return json({ ok: false, error: "state_store_auth_required" }, 401);
      }
      await this.ready;
      const key = url.searchParams.get("key") || "";
      if (!/^oidc-preview-e2e:pause-[a-f0-9]{40}$/.test(key)) {
        return json({ ok: false, error: "task_key_invalid" }, 400);
      }
      const row = this.sql.exec(
        "SELECT task_id, state, error_code, lease_owner, lease_expires_at, lease_generation " +
        "FROM tasks WHERE idempotency_key = ?",
        key,
      ).toArray()[0];
      if (!row) return json({ ok: false, error: "task_not_found" }, 404);
      const audit = this.sql.exec(
        "SELECT COUNT(*) AS count FROM audit_events WHERE task_id = ? AND event_type = 'task.cancelled'",
        row.task_id,
      ).toArray()[0];
      const control = this.sql.exec(
        "SELECT paused, version FROM runtime_control WHERE singleton_id = 1",
      ).toArray()[0];
      const pauseAudit = this.sql.exec(
        "SELECT action, actor, reason, occurred_at FROM runtime_control_audit " +
        "WHERE action = 'pause' ORDER BY occurred_at DESC LIMIT 10",
      ).toArray();
      return json({
        ok: true,
        task: {
          state: row.state,
          errorCode: row.error_code,
          leaseOwned: typeof row.lease_owner === "string" && row.lease_owner.length > 0,
          leaseExpiresAt: row.lease_expires_at,
          leaseGeneration: row.lease_generation,
        },
        cancellationAuditCount: Number(audit?.count || 0),
        control: {
          paused: control?.paused === 1,
          version: control?.version ?? null,
        },
        pauseAudit,
        gateState: await this.ctx.storage.get("pause-e2e-gate-state") || "idle",
      });
    }

    return super.fetch(request);
  }
}

async function performIndependentOidcPause(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (env.AGENT_PAUSE_E2E_GATE_ENABLED !== "true" || env.AGENT_OIDC_ENABLED !== "true") {
    return json({ ok: false, error: "pause_e2e_disabled" }, 503);
  }
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    return json({ ok: false, error: "request_invalid" }, 400);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    return json({ ok: false, error: "json_content_type_required" }, 415);
  }
  const rawBody = await request.text();
  if (rawBody.length > 256) return json({ ok: false, error: "request_body_too_large" }, 413);
  let body;
  try { body = JSON.parse(rawBody); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
    return json({ ok: false, error: "pause_e2e_request_invalid" }, 400);
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
    ref: env.AGENT_OIDC_PAUSE_REF,
    workflowRef: env.AGENT_OIDC_PAUSE_WORKFLOW_REF,
    actorId: env.AGENT_OIDC_PAUSE_ACTOR_ID,
    eventName: "pull_request",
    environment: "agent-runtime-preview",
  };
  if (!Object.entries(expected).every(([key, value]) =>
    typeof value === "string" && value.length > 0 &&
    value.length <= (key === "workflowRef" ? 512 : 256)) ||
      !/^\d{1,20}$/.test(expected.actorId) ||
      !/^\d{1,20}$/.test(expected.repositoryId) ||
      !/^\d{1,20}$/.test(expected.repositoryOwnerId)) {
    return json({ ok: false, error: "github_oidc_pause_policy_unconfigured" }, 503);
  }

  const authorized = await authorizeGitHubActionsOperator(tokenMatch[1], { env, expected });
  if (!authorized.ok) {
    if (authorized.error === "oidc_token_replayed") {
      return json({ ok: false, error: "github_oidc_token_replayed" }, 409);
    }
    if (authorized.error?.includes("unavailable") || authorized.error === "oidc_replay_response_invalid") {
      return json({ ok: false, error: "github_oidc_verification_unavailable" }, 503);
    }
    return json({ ok: false, error: "github_oidc_token_invalid" }, 401);
  }

  const actor = "github-actions:" + authorized.identity.actorId;
  try {
    const observed = await stateStoreRequest(env, "/control");
    const version = observed?.control?.version;
    if (!Number.isSafeInteger(version) || version < 0 || !Number.isSafeInteger(version + 1)) {
      throw new Error("runtime_control_snapshot_invalid");
    }

    const draftNamespace = env.AGENT_DRAFT_STORE;
    if (!draftNamespace || typeof draftNamespace.idFromName !== "function" ||
        typeof draftNamespace.get !== "function") throw new Error("draft_store_unavailable");
    const draftStore = draftNamespace.get(draftNamespace.idFromName("agent-authoring-global"));
    if (!draftStore || typeof draftStore.setRuntimePaused !== "function") {
      throw new Error("draft_store_control_unavailable");
    }
    const fenced = await draftStore.setRuntimePaused(true, version + 1);
    if (fenced?.updated !== true || fenced.paused !== true || fenced.version !== version + 1) {
      return json({ ok: false, error: "draft_store_pause_fence_failed" }, 409);
    }

    try {
      const result = await stateStoreRequest(env, "/control/pause", {
        actor,
        requestId: crypto.randomUUID(),
        reason: PAUSE_REASON,
      });
      const synced = await draftStore.setRuntimePaused(result.control.paused, result.control.version);
      if (synced?.updated !== true || synced.paused !== result.control.paused ||
          synced.version !== result.control.version) {
        throw new Error("draft_store_control_sync_failed");
      }
      return json({ ok: true, changed: result.changed, control: result.control });
    } catch (error) {
      try {
        const current = await stateStoreRequest(env, "/control");
        await draftStore.setRuntimePaused(current.control.paused, current.control.version);
      } catch {}
      throw error;
    }
  } catch {
    return json({ ok: false, error: "control_unavailable" }, 503);
  }
}

const pauseE2eWorker = {
  async fetch(request, env, ctx) {
    runtimeEnv = env;
    const url = new URL(request.url);

    if (url.pathname === "/__e2e/status") {
      if (env.AGENT_PAUSE_E2E_GATE_ENABLED !== "true") {
        return json({ ok: false, error: "not_found" }, 404);
      }
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      const key = url.searchParams.get("key") || "";
      if (!/^oidc-preview-e2e:pause-[a-f0-9]{40}$/.test(key)) {
        return json({ ok: false, error: "task_key_invalid" }, 400);
      }
      const namespace = env.AGENT_STATE_STORE;
      if (!namespace || typeof namespace.idFromName !== "function" ||
          typeof namespace.get !== "function") {
        return json({ ok: false, error: "state_store_binding_unavailable" }, 503);
      }
      const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
      return stub.fetch(new Request(
        "https://state-store.internal/__e2e/task-status?key=" + encodeURIComponent(key),
        { headers: { Authorization: "Bearer " + env.AGENT_STATE_STORE_TOKEN } },
      ));
    }

    if (url.pathname === "/__e2e/pause") {
      return performIndependentOidcPause(request, env);
    }

    return worker.fetch(request, env, ctx);
  },
};

export default pauseE2eWorker;
