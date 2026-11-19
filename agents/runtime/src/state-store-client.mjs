import { validateTaskRequest } from "./task-contract.mjs";

const INTERNAL_TOKEN_PATTERN = /^Bearer [A-Za-z0-9._~+/-]+=*$/;
const MAX_TOKEN_LENGTH = 512;
const MAX_BODY_BYTES = 16 * 1024;
const STORE_IDENTITY = "agent-runtime-global";
const STORE_ORIGIN = "https://agent-state-store.internal";

const OPERATIONS = Object.freeze({
  reserve: Object.freeze({ method: "POST", path: "/reserve" }),
  transition: Object.freeze({ method: "POST", path: "/transition" }),
  task: Object.freeze({ method: "GET", path: "/task" }),
  usage: Object.freeze({ method: "GET", path: "/usage" }),
});

function unavailable() {
  const error = new Error("state_store_unavailable");
  error.code = "state_store_unavailable";
  return error;
}

function validToken(value) {
  return typeof value === "string" &&
    value.length >= 32 &&
    value.length <= MAX_TOKEN_LENGTH &&
    INTERNAL_TOKEN_PATTERN.test("Bearer " + value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function operationUrl(operation, input) {
  const definition = OPERATIONS[operation];
  if (!definition) throw new TypeError("state_store_operation_not_allowed");

  const url = new URL(definition.path, STORE_ORIGIN);
  if (operation === "task") {
    if (!isPlainObject(input) || Object.keys(input).length !== 1 ||
        typeof input.taskId !== "string" || input.taskId.length < 1 || input.taskId.length > 64) {
      throw new TypeError("state_store_task_id_invalid");
    }
    url.searchParams.set("id", input.taskId);
  } else if (operation === "usage") {
    if (!isPlainObject(input) || Object.keys(input).some((key) => key !== "day")) {
      throw new TypeError("state_store_usage_query_invalid");
    }
    if (input.day !== undefined) {
      if (typeof input.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
          Number.isNaN(Date.parse(input.day + "T00:00:00Z"))) {
        throw new TypeError("state_store_usage_day_invalid");
      }
      url.searchParams.set("day", input.day);
    }
  } else if (operation === "reserve") {
    if (!isPlainObject(input) || Object.keys(input).length !== 1 ||
        !Object.hasOwn(input, "task") || !isPlainObject(input.task)) {
      throw new TypeError("state_store_request_invalid");
    }
    const validation = validateTaskRequest(input.task);
    if (!validation.ok) throw new TypeError("state_store_task_invalid:" + validation.error);
  } else if (operation === "transition") {
    const keys = isPlainObject(input) ? Object.keys(input) : [];
    if (!isPlainObject(input) || !Object.hasOwn(input, "taskId") ||
        !Object.hasOwn(input, "status") ||
        keys.some((key) => !["taskId", "status", "errorCode"].includes(key)) ||
        typeof input.taskId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(input.taskId) ||
        !["running", "succeeded", "failed", "cancelled"].includes(input.status) ||
        (input.errorCode !== undefined && (input.status !== "failed" ||
          typeof input.errorCode !== "string" || !/^[a-z0-9_.:-]{1,64}$/.test(input.errorCode)))) {
      throw new TypeError("state_store_request_invalid");
    }
  }
  return url;
}

/**
 * Calls only fixed State Store operations through the dedicated internal token.
 * Caller headers, cookies, Origin, and caller-supplied URLs are never forwarded.
 * This client is intentionally not wired into a Worker route until a DO binding
 * and independent security review are approved.
 */
export async function callStateStore(env = {}, operation, input = {}) {
  const namespace = env.AGENT_STATE_STORE;
  const token = env.AGENT_STATE_STORE_TOKEN;
  if (!namespace || typeof namespace.idFromName !== "function" ||
      typeof namespace.get !== "function" || !validToken(token)) {
    throw unavailable();
  }

  const definition = OPERATIONS[operation];
  if (!definition) throw new TypeError("state_store_operation_not_allowed");

  const url = operationUrl(operation, input);
  const init = {
    method: definition.method,
    headers: { Authorization: "Bearer " + token },
  };

  if (definition.method === "POST") {
    const body = JSON.stringify(input);
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      throw new TypeError("state_store_request_too_large");
    }
    init.headers["Content-Type"] = "application/json";
    init.body = body;
  }

  try {
    const id = namespace.idFromName(STORE_IDENTITY);
    const stub = namespace.get(id);
    if (!stub || typeof stub.fetch !== "function") throw unavailable();
    return await stub.fetch(new Request(url, init));
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("state_store_")) throw error;
    throw unavailable();
  }
}
