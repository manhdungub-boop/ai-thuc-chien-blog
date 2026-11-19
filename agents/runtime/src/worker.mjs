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
    throw Object.assign(new Error("state_store_request_failed"), { status, code: body?.error });
  }
  return body;
}

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
      const parsedBody = await readBoundedJsonRequest(request, 1024);
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
    if (url.pathname === "/internal/task/recover") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (env.AGENT_ENABLED !== "true" || env.AGENT_PAUSED !== "false") {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }
      if (!await hasValidOperatorBearer(request, env)) return json({ ok: false, error: "operator_auth_required" }, 401);
      if ([...url.searchParams.keys()].length > 0) return json({ ok: false, error: "request_invalid" }, 400);
      const actor = env.AGENT_OPERATOR_ID;
      if (typeof actor !== "string" || !/^[a-zA-Z0-9._:-]{3,64}$/.test(actor)) {
        return json({ ok: false, error: "operator_identity_unavailable" }, 503);
      }
      const parsedBody = await readBoundedJsonRequest(request, 1024);
      if (!parsedBody.ok) {
        return json({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
      }
      const body = parsedBody.value;
      if (body === null || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || typeof body.taskId !== "string" ||
          body.taskId.length < 1 || body.taskId.length > 64 ||
          [...body.taskId].some((character) => character.charCodeAt(0) < 33 || character.charCodeAt(0) === 127)) {
        return json({ ok: false, error: "request_invalid" }, 400);
      }
      try {
        const result = await writeStateStore(env, "/recover", {
          taskId: body.taskId,
          actor,
          requestId: crypto.randomUUID(),
        });
        const task = result.task;
        if (!task || typeof task.taskId !== "string" ||
            !["queued", "failed"].includes(task.state) ||
            !["requeued", "failed"].includes(result.outcome)) {
          return json({ ok: false, error: "state_store_response_invalid" }, 503);
        }
        return json({ ok: true, outcome: result.outcome, task: {
          taskId: task.taskId,
          state: task.state,
          attemptCount: task.attemptCount,
          maxAttempts: task.maxAttempts,
          nextAttemptAt: task.nextAttemptAt,
          lastErrorCode: task.lastErrorCode,
        } });
      } catch (error) {
        if (error?.status === 404) return json({ ok: false, error: "task_not_found" }, 404);
        if (error?.status === 409) return json({ ok: false, error: "recovery_conflict" }, 409);
        if (error?.status === 429) return json({ ok: false, error: "rate_limited" }, 429);
        if (error?.status === 503 && error?.code === "agent_disabled_or_paused") {
          return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
        }
        return json({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    if (url.pathname === "/internal/usage" || url.pathname === "/internal/metrics" || url.pathname === "/internal/task" || url.pathname === "/internal/dead-letter") {
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
          return json({
            ok: true, dayUtc: result.dayUtc,
            acceptedToday: result.acceptedToday, inFlight: result.inFlight,
          });
        }
        if (url.pathname === "/internal/dead-letter") {
          const requestedLimit = Number(url.searchParams.get("limit") ?? "25");
          const validNullableCode = (value) => value === null || (typeof value === "string" && value.length > 0 && value.length <= 64);
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
                Number.isSafeInteger(item.attemptCount) && item.attemptCount >= 0 &&
                Number.isSafeInteger(item.maxAttempts) && item.maxAttempts >= 1 && item.maxAttempts <= 5)) {
            return json({ ok: false, error: "state_store_response_invalid" }, 503);
          }
          const items = result.items.map((item) => ({
            taskId: item.taskId, type: item.type, createdAt: item.createdAt,
            terminalAt: item.terminalAt, errorCode: item.errorCode,
            lastErrorCode: item.lastErrorCode, attemptCount: item.attemptCount,
            maxAttempts: item.maxAttempts,
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
          const quotaFields = ["acceptedToday", "dailyLimit", "dailyUtilizationPercent", "inFlight", "concurrentLimit", "concurrentUtilizationPercent", "payloadLimitBytes"];
          const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
          const validPercent = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
          const validAge = (value) => value === null || validCount(value);
          if (!result.tasks || !result.quota || !Array.isArray(result.auditLast24h) ||
              !Number.isSafeInteger(result.observedAt) ||
              typeof result.dayUtc !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(result.dayUtc) ||
              typeof result.note !== "string" ||
              !taskFields.every((field) => validCount(result.tasks[field])) ||
              !validAge(result.tasks.oldestQueuedAgeMs) || !validAge(result.tasks.oldestRunningUpdateAgeMs) ||
              !["dailyUtilizationPercent", "concurrentUtilizationPercent"].every((field) => validPercent(result.quota[field])) ||
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
        } });
      } catch (error) {
        if (error?.status === 404) return json({ ok: false, error: "task_not_found" }, 404);
        return json({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    return json({ ok: false, error: "not_found" }, 404);
  },
};
