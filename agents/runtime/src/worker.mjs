import { hasValidOperatorBearer } from "./operator-auth.mjs";
import { hasValidStateStoreBearer } from "./internal-auth.mjs";
export { AgentStateStore } from "./state-store.mjs";

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
});
const MAX_INTERNAL_RESPONSE_BYTES = 16 * 1024;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}
function isEnabled(value) { return value === "true"; }

async function readBoundedJson(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_INTERNAL_RESPONSE_BYTES) throw new Error("internal_response_too_large");
  if (!response.body) throw new Error("internal_response_empty");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INTERNAL_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("internal_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
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

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      return json({
        ok: true,
        service: "ai-thuc-chien-agent-runtime-preview",
        enabled: isEnabled(env.AGENT_ENABLED),
        paused: env.AGENT_PAUSED !== "false",
        execution: "not_implemented",
      });
    }
    if (url.pathname === "/run") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!isEnabled(env.AGENT_ENABLED) || isEnabled(env.AGENT_PAUSED)) {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      return json({ ok: false, error: "execution_not_implemented" }, 501);
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
        } });
      } catch (error) {
        if (error?.status === 404) return json({ ok: false, error: "task_not_found" }, 404);
        return json({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    return json({ ok: false, error: "not_found" }, 404);
  },
};
