import { validateTaskRequest } from "./task-contract.mjs";
import { hasValidStateStoreBearer } from "./internal-auth.mjs";

const SCHEMA_VERSION = 1;
// Conservative Free-tier pilot defaults; hard caps remain enforced below.
const DEFAULT_LIMITS = Object.freeze({ daily: 100, concurrent: 5, payloadBytes: 8192 });
const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);
const TASK_TYPES_SQL = "'content.review','ai_bank.candidate_review','seo.audit'";
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

function bodyError(status, code) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  return error;
}

async function readBoundedJson(request) {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^[0-9]+$/.test(declaredLength)) throw bodyError(400, "request_content_length_invalid");
    if (Number(declaredLength) > MAX_REQUEST_BODY_BYTES) throw bodyError(413, "request_body_too_large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw bodyError(400, "request_json_invalid");
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      throw bodyError(413, "request_body_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(decoded);
  } catch {
    throw bodyError(400, "request_json_invalid");
  }
}

function boundedLimit(value, fallback, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error("runtime_limit_configuration_invalid");
  return parsed;
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }});
}
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function readRow(sql, query, ...bindings) { return sql.exec(query, ...bindings).toArray()[0] ?? null; }
function utcDay(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function safeTask(row) {
  if (!row) return null;
  return {
    taskId: row.task_id, idempotencyKey: row.idempotency_key, type: row.task_type,
    payload: JSON.parse(row.payload_json), state: row.state, createdAt: row.created_at,
    updatedAt: row.updated_at, terminalAt: row.terminal_at, errorCode: row.error_code,
  };
}

/** SQLite-backed coordination store. Not bound by the checked-in Preview config. */
export class AgentStateStore {
  constructor(ctx, env = {}) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      ctx.storage.transactionSync(() => {
        const schema = [
          "CREATE TABLE IF NOT EXISTS runtime_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
          "CREATE TABLE IF NOT EXISTS daily_usage (day_utc TEXT PRIMARY KEY, accepted_count INTEGER NOT NULL CHECK (accepted_count >= 0))",
          "CREATE TABLE IF NOT EXISTS tasks (task_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, task_type TEXT NOT NULL CHECK (task_type IN (" + TASK_TYPES_SQL + ")), payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 1 AND 8192), state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, terminal_at INTEGER, error_code TEXT)",
          "CREATE INDEX IF NOT EXISTS tasks_state_idx ON tasks(state)",
          "CREATE INDEX IF NOT EXISTS tasks_terminal_idx ON tasks(terminal_at)",
          "CREATE TABLE IF NOT EXISTS audit_events (event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at INTEGER NOT NULL, metadata_json TEXT NOT NULL CHECK (length(metadata_json) <= 1024))",
          "CREATE INDEX IF NOT EXISTS audit_occurred_idx ON audit_events(occurred_at)",
        ];
        for (const statement of schema) this.sql.exec(statement);
        const version = readRow(this.sql, "SELECT value FROM runtime_meta WHERE key = 'schema_version'");
        if (version && version.value !== String(SCHEMA_VERSION)) throw new Error("runtime_schema_version_unsupported");
        this.sql.exec("INSERT OR IGNORE INTO runtime_meta (key, value) VALUES ('schema_version', ?)", String(SCHEMA_VERSION));
      });
    });
  }

  async fetch(request) {
    if (!await hasValidStateStoreBearer(request, this.env)) {
      return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
    }
    try {
      await this.ready;
      const url = new URL(request.url);
      if (url.pathname === "/reserve" && request.method === "POST") {
        const result = await this.reserve(await readBoundedJson(request), this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/transition" && request.method === "POST") {
        const result = this.transition(await readBoundedJson(request), this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/task" && request.method === "GET") {
        const taskId = url.searchParams.get("id");
        if (!taskId || taskId.length > 64) return jsonResponse({ ok: false, error: "task_id_invalid" }, 400);
        const row = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", taskId);
        return row ? jsonResponse({ ok: true, task: safeTask(row) }) : jsonResponse({ ok: false, error: "task_not_found" }, 404);
      }
      if (url.pathname === "/usage" && request.method === "GET") {
        const day = url.searchParams.get("day") ?? utcDay(this.requestTime(request));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day + "T00:00:00Z"))) {
          return jsonResponse({ ok: false, error: "utc_day_invalid" }, 400);
        }
        const usage = readRow(this.sql, "SELECT accepted_count FROM daily_usage WHERE day_utc = ?", day);
        const active = readRow(this.sql, "SELECT COUNT(*) AS count FROM tasks WHERE state IN ('queued','running')");
        return jsonResponse({ ok: true, dayUtc: day, acceptedToday: usage?.accepted_count ?? 0, inFlight: active?.count ?? 0 });
      }
      if (url.pathname === "/__test/rollback" && request.method === "POST") {
        if (this.env.RUNTIME_TESTING !== "true") return jsonResponse({ ok: false, error: "not_found" }, 404);
        try {
          this.ctx.storage.transactionSync(() => {
            this.sql.exec("INSERT INTO daily_usage (day_utc, accepted_count) VALUES ('2099-12-31', 1)");
            throw new Error("intentional_rollback_probe");
          });
        } catch {
          const usage = readRow(this.sql, "SELECT accepted_count FROM daily_usage WHERE day_utc = '2099-12-31'");
          return jsonResponse({ ok: true, rolledBack: usage === null, acceptedToday: usage?.accepted_count ?? 0 });
        }
        return jsonResponse({ ok: false, error: "rollback_probe_did_not_throw" }, 500);
      }
      if (request.method !== "GET" && request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    } catch (error) {
      if (error?.status === 400 || error?.status === 413) {
        return jsonResponse({ ok: false, error: error.code }, error.status);
      }
      return jsonResponse({ ok: false, error: "state_store_unavailable" }, 503);
    }
  }

  requestTime(request) {
    if (this.env.RUNTIME_TESTING === "true") {
      const value = request.headers.get("x-test-now");
      if (value) { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; }
    }
    return Date.now();
  }

  limits() {
    return {
      daily: boundedLimit(this.env.RUNTIME_MAX_TASKS_PER_DAY, DEFAULT_LIMITS.daily, DEFAULT_LIMITS.daily),
      concurrent: boundedLimit(this.env.RUNTIME_MAX_CONCURRENT_TASKS, DEFAULT_LIMITS.concurrent, DEFAULT_LIMITS.concurrent),
      payloadBytes: DEFAULT_LIMITS.payloadBytes,
    };
  }

  async reserve(body, now) {
    // Admission must remain closed unless both runtime controls explicitly allow it.
    if (this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED !== "false") {
      return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
    }
    if (!isObject(body) || Object.keys(body).length !== 1 || !("task" in body)) {
      return { status: 400, body: { ok: false, error: "reserve_request_invalid" } };
    }
    const validation = validateTaskRequest(body.task);
    if (!validation.ok) return { status: 400, body: { ok: false, error: validation.error } };
    const task = validation.task;
    const payloadJson = JSON.stringify(task.payload);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(task)).byteLength;
    const limits = this.limits();
    if (payloadBytes > limits.payloadBytes) return { status: 413, body: { ok: false, error: "payload_limit_exceeded" } };
    const payloadHash = await sha256Hex(task.type + "\n" + payloadJson);
    const taskId = crypto.randomUUID();
    const day = utcDay(now);

    try {
      return this.ctx.storage.transactionSync(() => {
        const existing = readRow(this.sql, "SELECT * FROM tasks WHERE idempotency_key = ?", task.idempotencyKey);
        if (existing) {
          if (existing.payload_hash !== payloadHash || existing.task_type !== task.type) {
            return { status: 409, body: { ok: false, error: "idempotency_key_conflict" } };
          }
          return { status: 200, body: { ok: true, duplicate: true, task: safeTask(existing) } };
        }
        this.prune(now);
        const usage = readRow(this.sql, "SELECT accepted_count FROM daily_usage WHERE day_utc = ?", day);
        const active = readRow(this.sql, "SELECT COUNT(*) AS count FROM tasks WHERE state IN ('queued','running')");
        if ((usage?.accepted_count ?? 0) >= limits.daily) return { status: 429, body: { ok: false, error: "daily_quota_exhausted" } };
        if ((active?.count ?? 0) >= limits.concurrent) return { status: 429, body: { ok: false, error: "concurrency_limit_reached" } };

        this.sql.exec(
          "INSERT INTO tasks (task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at) VALUES (?,?,?,?,?,?,'queued',?,?)",
          taskId, task.idempotencyKey, task.type, payloadJson, payloadHash, payloadBytes, now, now,
        );
        this.sql.exec("INSERT INTO daily_usage (day_utc,accepted_count) VALUES (?,1) ON CONFLICT(day_utc) DO UPDATE SET accepted_count = accepted_count + 1", day);
        this.audit(taskId, "task.queued", now, { taskType: task.type });
        return { status: 201, body: { ok: true, duplicate: false, task: safeTask(readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", taskId)) } };
      });
    } catch {
      return { status: 503, body: { ok: false, error: "state_store_unavailable" } };
    }
  }

  transition(body, now) {
    if (!isObject(body) || Object.keys(body).some((key) => !["taskId","status","errorCode"].includes(key)) ||
        !Object.hasOwn(body, "taskId") || !Object.hasOwn(body, "status") ||
        typeof body.taskId !== "string" || body.taskId.length > 64) {
      return { status: 400, body: { ok: false, error: "transition_request_invalid" } };
    }
    const next = body.status;
    if (!["running","succeeded","failed","cancelled"].includes(next)) return { status: 400, body: { ok: false, error: "task_status_invalid" } };
    // The pause switch must also stop queued work from entering the running state.
    // Terminal transitions remain available so an operator/recovery path can cancel or fail work.
    if (next === "running" && (this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED !== "false")) {
      return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
    }
    if (body.errorCode !== undefined && (next !== "failed" || typeof body.errorCode !== "string" || !/^[a-z0-9_.:-]{1,64}$/.test(body.errorCode))) {
      return { status: 400, body: { ok: false, error: "error_code_invalid" } };
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        const row = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!row) return { status: 404, body: { ok: false, error: "task_not_found" } };
        if (TERMINAL_STATES.has(row.state)) {
          if (row.state === next) return { status: 200, body: { ok: true, duplicate: true, task: safeTask(row) } };
          return { status: 409, body: { ok: false, error: "terminal_state_conflict" } };
        }
        const allowed = row.state === "queued" ? ["running","cancelled"] : row.state === "running" ? ["succeeded","failed","cancelled"] : [];
        if (!allowed.includes(next)) return { status: 409, body: { ok: false, error: "task_transition_invalid" } };
        const terminalAt = TERMINAL_STATES.has(next) ? now : null;
        const errorCode = next === "failed" ? (body.errorCode ?? "task_failed") : null;
        this.sql.exec("UPDATE tasks SET state=?,updated_at=?,terminal_at=?,error_code=? WHERE task_id=?", next, now, terminalAt, errorCode, body.taskId);
        const updated = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        this.audit(body.taskId, "task." + next, now, { taskType: row.task_type });
        return { status: 200, body: { ok: true, duplicate: false, task: safeTask(updated) } };
      });
    } catch {
      return { status: 503, body: { ok: false, error: "state_store_unavailable" } };
    }
  }

  audit(taskId, eventType, now, metadata) {
    this.sql.exec("INSERT INTO audit_events (event_id,task_id,event_type,occurred_at,metadata_json) VALUES (?,?,?,?,?)",
      crypto.randomUUID(), taskId, eventType, now, JSON.stringify(metadata));
  }

  prune(now) {
    const taskCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const auditCutoff = now - 90 * 24 * 60 * 60 * 1000;
    this.sql.exec("DELETE FROM tasks WHERE state IN ('succeeded','failed','cancelled') AND terminal_at < ?", taskCutoff);
    this.sql.exec("DELETE FROM audit_events WHERE occurred_at < ?", auditCutoff);
    this.sql.exec("DELETE FROM daily_usage WHERE day_utc < ?", utcDay(auditCutoff));
  }
}
