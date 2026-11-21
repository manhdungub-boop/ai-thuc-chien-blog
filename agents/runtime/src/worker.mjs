import { hasValidOperatorBearer } from "./operator-auth.mjs";
import { hasValidStateStoreBearer } from "./internal-auth.mjs";
import { readBoundedJson as readBoundedJsonBody, readBoundedText } from "./bounded-json-body.mjs";
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
  const allowedKeys = new Set(["reason", "actor", "requestId"]);
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

async function readBoundedControlJson(request, maxBytes) {
  const bounded = await readBoundedText(request, maxBytes);
  if (!bounded.ok) return bounded;
  try { return { ok: true, value: parseControlJson(bounded.value) }; }
  catch { return { ok: false, status: 400, error: "invalid_control_json" }; }
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
      if (!isEnabled(env.AGENT_ENABLED) || env.AGENT_PAUSED !== "false") {
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
