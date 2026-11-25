import worker, { AgentStateStore } from "../src/worker.mjs";
import { hasValidStateStoreBearer } from "../src/internal-auth.mjs";

const TARGET_ARTICLE_URL =
  "https://raw.githubusercontent.com/manhdungub-boop/ai-thuc-chien-blog/main/articles/ai-agent-thuc-hanh-tu-thiet-ke-den-kiem-soat.html";
const GATE_TIMEOUT_MS = 120_000;
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

async function recordGateState(state) {
  const namespace = runtimeEnv?.AGENT_STATE_STORE;
  const token = runtimeEnv?.AGENT_STATE_STORE_TOKEN;
  if (!namespace || typeof namespace.idFromName !== "function" ||
      typeof namespace.get !== "function" || typeof token !== "string") {
    throw new Error("pause_e2e_gate_state_store_unavailable");
  }
  const stub = namespace.get(namespace.idFromName("agent-runtime-global"));
  const response = await stub.fetch(new Request(
    "https://state-store.internal/__e2e/gate-state",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state }),
    },
  ));
  if (!response.ok) throw new Error("pause_e2e_gate_state_write_failed");
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

// This test-only entrypoint intercepts exactly one public, read-only GitHub
// article fetch. The production Worker entrypoint never imports this module.
// The real Preview reader receives the original AbortSignal and must unwind
// when the independent OIDC Pause causes the lease heartbeat to be fenced.
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
      if (!signal?.aborted) {
        await recordGateState("timeout");
      }
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
      if (!/^oidc-preview-e2e:pause-[0-9]+-[0-9]+$/.test(key)) {
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
          taskId: row.task_id,
          state: row.state,
          errorCode: row.error_code,
          leaseOwner: row.lease_owner,
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

const pauseE2eWorker = {
  async fetch(request, env, ctx) {
    runtimeEnv = env;
    const url = new URL(request.url);

    if (url.pathname === "/__e2e/status") {
      if (env.AGENT_PAUSE_E2E_GATE_ENABLED !== "true") {
        return json({ ok: false, error: "not_found" }, 404);
      }
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!await hasValidStateStoreBearer(request, env)) {
        return json({ ok: false, error: "state_store_auth_required" }, 401);
      }
      const key = url.searchParams.get("key") || "";
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

    return worker.fetch(request, env, ctx);
  },
};

export default pauseE2eWorker;
