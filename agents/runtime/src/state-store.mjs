import { validateTaskRequest } from "./task-contract.mjs";
import { readBoundedJson, readBoundedText } from "./bounded-json-body.mjs";
import { hasValidStateStoreBearer } from "./internal-auth.mjs";
import { claimQueuedTask, heartbeatLease, recoverExpiredLease, completeLeasedTask } from "./lease-policy.mjs";

const SCHEMA_VERSION = 7;
// Conservative Free-tier pilot defaults; hard caps remain enforced below.
const DEFAULT_LIMITS = Object.freeze({ daily: 100, concurrent: 5, payloadBytes: 8192 });
const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);
const TASK_TYPES_SQL = "'content.review','ai_bank.candidate_review','seo.audit'";
const CIRCUIT_BREAKER = Object.freeze({ threshold: 5, windowMs: 10 * 60 * 1000 });
const EXTERNAL_REQUEST_LIMITS = Object.freeze({ ai_bank_discovery: 10, content_research: 8 });

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
function isValidUtcDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const timestamp = Date.parse(day + "T00:00:00.000Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day;
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
  const allowedKeys = new Set(["reason", "actor", "requestId", "jti", "expiresAt"]);
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
function readRow(sql, query, ...bindings) { return sql.exec(query, ...bindings).toArray()[0] ?? null; }
function utcDay(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function validatePersistedResult(value) {
  if (!isObject(value) || Object.keys(value).sort().join(",") !== "findingCount,findings,status,taskType" ||
      !["content.review", "ai_bank.candidate_review", "seo.audit"].includes(value.taskType) ||
      !["pass", "attention", "review_required"].includes(value.status) ||
      !Number.isSafeInteger(value.findingCount) || value.findingCount < 0 || value.findingCount > 20 ||
      !Array.isArray(value.findings) || value.findings.length > 20 ||
      value.findings.length !== value.findingCount) return null;
  for (const item of value.findings) {
    if (!isObject(item) || Object.keys(item).sort().join(",") !== "code,message,severity" ||
        typeof item.code !== "string" || !/^[a-z][a-z0-9_]{1,79}$/.test(item.code) ||
        !["error", "warning"].includes(item.severity) ||
        typeof item.message !== "string" || item.message.length < 1 || item.message.length > 256 ||
        item.message.trim() !== item.message || /[\u0000-\u001f\u007f]/.test(item.message)) return null;
  }
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > 4096) return null;
  return json;
}
function safeTask(row) {
  if (!row) return null;
  return {
    taskId: row.task_id, idempotencyKey: row.idempotency_key, type: row.task_type,
    payload: JSON.parse(row.payload_json), state: row.state, createdAt: row.created_at,
    updatedAt: row.updated_at, terminalAt: row.terminal_at, errorCode: row.error_code,
    attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
    leaseGeneration: row.lease_generation, leaseExpiresAt: row.lease_expires_at, leaseMaxExpiresAt: row.lease_max_expires_at,
    nextAttemptAt: row.next_attempt_at, lastErrorCode: row.last_error_code,
    result: row.result_json ? JSON.parse(row.result_json) : null,
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
        let version = readRow(this.sql, "SELECT value FROM runtime_meta WHERE key = 'schema_version'");
        if (!version) {
          this.sql.exec("INSERT INTO runtime_meta (key, value) VALUES ('schema_version', '1')");
          version = { value: "1" };
        }
        if (version.value === "1") {
          // Transactional v1 -> v2 migration. Fresh databases deliberately follow
          // the same path as persisted v1 databases so both cases share one code path.
          const columns = [
            "ALTER TABLE tasks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5)",
            "ALTER TABLE tasks ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5)",
            "ALTER TABLE tasks ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0)",
            "ALTER TABLE tasks ADD COLUMN lease_owner TEXT CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 16 AND 64)",
            "ALTER TABLE tasks ADD COLUMN lease_expires_at INTEGER",
            "ALTER TABLE tasks ADD COLUMN lease_max_expires_at INTEGER",
            "ALTER TABLE tasks ADD COLUMN next_attempt_at INTEGER",
            "ALTER TABLE tasks ADD COLUMN last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 64)",
          ];
          for (const statement of columns) this.sql.exec(statement);
          this.sql.exec("CREATE INDEX IF NOT EXISTS tasks_retry_due_idx ON tasks(state, next_attempt_at)");
          this.sql.exec("CREATE INDEX IF NOT EXISTS tasks_lease_expiry_idx ON tasks(state, lease_expires_at)");
          this.sql.exec("UPDATE runtime_meta SET value = '2' WHERE key = 'schema_version'");
          version = { value: "2" };
        }
        if (version.value === "2") {
          this.sql.exec("CREATE TABLE runtime_control (singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1), paused INTEGER NOT NULL CHECK (paused IN (0,1)), changed_at INTEGER NOT NULL, version INTEGER NOT NULL CHECK (version >= 0))");
          this.sql.exec("CREATE TABLE runtime_control_audit (event_id TEXT PRIMARY KEY, action TEXT NOT NULL CHECK (action IN ('pause','resume')), occurred_at INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, request_id TEXT NOT NULL)");
          // Durable control starts fail-closed on every fresh/migrated store.
          // An operator must explicitly resume after the outer deployment gates are reviewed.
          this.sql.exec("INSERT INTO runtime_control (singleton_id, paused, changed_at, version) VALUES (1, 1, 0, 0)");
          this.sql.exec("CREATE INDEX runtime_control_audit_time_idx ON runtime_control_audit(occurred_at)");
          this.sql.exec("UPDATE runtime_meta SET value = '3' WHERE key = 'schema_version'");
          version = { value: "3" };
        }
        if (version.value === "3") {
          this.sql.exec("CREATE TABLE runtime_control_rate_limit (actor TEXT PRIMARY KEY, window_started_at INTEGER NOT NULL, request_count INTEGER NOT NULL CHECK (request_count >= 0))");
          this.sql.exec("UPDATE runtime_meta SET value = '4' WHERE key = 'schema_version'");
          version = { value: "4" };
        }
        if (version.value === "4") {
          this.sql.exec("CREATE TABLE oidc_jti_replay (jti_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, consumed_at INTEGER NOT NULL CHECK (consumed_at >= 0), CHECK (expires_at > consumed_at))");
          this.sql.exec("CREATE INDEX oidc_jti_replay_expiry_idx ON oidc_jti_replay(expires_at)");
          this.sql.exec("UPDATE runtime_meta SET value = '5' WHERE key = 'schema_version'");
          version = { value: "5" };
        }
        if (version.value === "5" || version.value === "6") {
          const taskColumns = this.sql.exec("PRAGMA table_info(tasks)").toArray();
          if (!taskColumns.some((column) => column.name === "result_json")) {
            this.sql.exec("ALTER TABLE tasks ADD COLUMN result_json TEXT CHECK (result_json IS NULL OR length(CAST(result_json AS BLOB)) <= 4096)");
          }
          this.sql.exec("CREATE TABLE IF NOT EXISTS external_request_budgets (budget_day TEXT NOT NULL CHECK (length(budget_day) = 10), scope TEXT NOT NULL CHECK (scope IN ('ai_bank_discovery','content_research')), used INTEGER NOT NULL CHECK (used >= 0), updated_at INTEGER NOT NULL CHECK (updated_at >= 0), PRIMARY KEY (budget_day, scope))");
          this.sql.exec("CREATE INDEX IF NOT EXISTS external_request_budget_day_idx ON external_request_budgets(budget_day)");
          this.sql.exec("UPDATE runtime_meta SET value = '7' WHERE key = 'schema_version'");
          version = { value: "7" };
        }
        if (version.value !== String(SCHEMA_VERSION)) {
          throw new Error("runtime_schema_version_unsupported");
        }
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
      if (url.pathname === "/control" && request.method === "GET") {
        return jsonResponse({ ok: true, control: this.controlState() });
      }
      if (url.pathname === "/oidc/replay/consume" && request.method === "POST") {
        const parsedBody = await readBoundedControlJson(request, 1024);
        if (!parsedBody.ok) {
          return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        }
        const result = await this.consumeOidcJti(parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if ((url.pathname === "/control/pause" || url.pathname === "/control/resume") && request.method === "POST") {
        const parsedBody = await readBoundedControlJson(request, 16 * 1024);
        if (!parsedBody.ok) {
          return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        }
        const result = this.setPaused(url.pathname.endsWith("/pause"), parsedBody.value, this.requestTime(request));
        if (result.status === 200) await this.scheduleRecoveryAlarm(this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
                  if (url.pathname === "/external-budget" && request.method === "GET") {
        const day = url.searchParams.get("day");
        const scope = url.searchParams.get("scope");
        const result = await this.getExternalRequestBudget(day, scope);
        return jsonResponse(result.ok ? { ok: true, budget: result } : { ok: false, error: result.error }, result.ok ? 200 : 400);
      }
      if (url.pathname === "/external-budget/consume" && request.method === "POST") {
        const parsedBody = await readBoundedJson(request, 1024);
        if (!parsedBody.ok) return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        if (!isObject(parsedBody.value) || Object.keys(parsedBody.value).length !== 2 || !Object.hasOwn(parsedBody.value, "day") || !Object.hasOwn(parsedBody.value, "scope")) {
          return jsonResponse({ ok: false, error: "external_request_budget_input_invalid" }, 400);
        }
        const result = await this.consumeExternalRequestBudget(parsedBody.value.day, parsedBody.value.scope, this.requestTime(request));
        return jsonResponse(result.ok ? { ok: true, budget: result } : { ok: false, error: result.error }, result.ok ? 200 : 400);
      }
      if (url.pathname === "/reserve" && request.method === "POST") {
        const parsedBody = await readBoundedJson(request, 16 * 1024);
        if (!parsedBody.ok) return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        const result = await this.reserve(parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/claim" && request.method === "POST") {
        const parsedBody = await readBoundedJson(request, 16 * 1024);
        if (!parsedBody.ok) return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        const result = await this.claim(parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/claim-next" && request.method === "POST") {
        const parsedBody = await readBoundedJson(request, 16 * 1024);
        if (!parsedBody.ok) return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        const result = await this.claimNext(parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/heartbeat" && request.method === "POST") {
        const parsedBody = await readBoundedJson(request, 16 * 1024);
        if (!parsedBody.ok) return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        const result = this.heartbeat(parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/complete" && request.method === "POST") {
        const parsedBody = await readBoundedJson(request, 16 * 1024);
        if (!parsedBody.ok) return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        const result = this.complete(parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/recover" && request.method === "POST") {
        const parsedBody = await readBoundedJson(request, 16 * 1024);
        if (!parsedBody.ok) return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        const result = this.recover(parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/transition" && request.method === "POST") {
        const parsedBody = await readBoundedJson(request, 16 * 1024);
        if (!parsedBody.ok) return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        const result = this.transition(parsedBody.value, this.requestTime(request));
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
      if (request.method !== "GET" && request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    } catch {
      return jsonResponse({ ok: false, error: "state_store_unavailable" }, 503);
    }
  }

  requestTime() {
    return Date.now();
  }

  async scheduleRecoveryAlarm(now = Date.now()) {
    if (this.env.AGENT_RECOVERY_ALARM_ENABLED !== "true" ||
        this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED !== "false") {
      try { await this.ctx.storage.deleteAlarm(); } catch {}
      return false;
    }
    try {
      const control = this.controlState();
      if (control.paused) {
        await this.ctx.storage.deleteAlarm();
        return false;
      }
      const next = readRow(this.sql,
        "SELECT MIN(lease_expires_at) AS next_at FROM tasks WHERE state='running' AND lease_expires_at IS NOT NULL");
      if (!next || next.next_at === null || next.next_at === undefined) {
        await this.ctx.storage.deleteAlarm();
        return false;
      }
      // One shared alarm per DO, with a five-minute minimum cadence.
      // This is recovery-only; it never claims or executes queued work.
      const desired = Math.max(now + 5 * 60 * 1000, next.next_at);
      const existing = await this.ctx.storage.getAlarm();
      if (existing === null || existing > desired) {
        await this.ctx.storage.setAlarm(desired);
      }
      return true;
    } catch {
      // Alarm scheduling is best-effort and must not turn a successful lease
      // claim into a false failure. The operator path remains available.
      return false;
    }
  }

  async alarm() {
    try {
      await this.ready;
    } catch {
      return;
    }
    if (this.env.AGENT_RECOVERY_ALARM_ENABLED !== "true" ||
        this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED !== "false") {
      try { await this.ctx.storage.deleteAlarm(); } catch {}
      return;
    }
    const now = Date.now();
    try {
      const recovered = this.ctx.storage.transactionSync(() => {
        if (this.controlState().paused) return 0;
        const rows = this.sql.exec(
          "SELECT * FROM tasks WHERE state='running' AND lease_expires_at<=? ORDER BY lease_expires_at LIMIT 5",
          now,
        ).toArray();
        let count = 0;
        for (const row of rows) {
          const decision = recoverExpiredLease(row, { now });
          if (!decision.ok) continue;
          const fields = decision.fields;
          this.sql.exec(
            "UPDATE tasks SET state=?,updated_at=?,terminal_at=?,error_code=?,lease_owner=NULL,lease_expires_at=NULL,lease_max_expires_at=NULL,next_attempt_at=?,last_error_code=? WHERE task_id=? AND state='running' AND lease_generation=? AND lease_expires_at<=?",
            fields.state, fields.updated_at, fields.terminal_at, fields.error_code,
            fields.next_attempt_at, fields.last_error_code, row.task_id, row.lease_generation, now,
          );
          const updated = readRow(this.sql, "SELECT state, lease_owner FROM tasks WHERE task_id=?", row.task_id);
          if (!updated || updated.state !== fields.state || updated.lease_owner !== null) continue;
          this.audit(row.task_id, decision.outcome === "failed" ? "task.lease_expired_failed" : "task.lease_expired_requeued", now, {
            attempt: row.attempt_count,
            leaseGeneration: row.lease_generation,
            source: "durable_object_alarm",
          });
          count++;
        }
        return count;
      });
      await this.scheduleRecoveryAlarm(now);
      return recovered;
    } catch {
      // Re-arm only through the same gate and durable-pause checks. If the
      // control state is unavailable, fail closed rather than retry forever.
      await this.scheduleRecoveryAlarm(now);
      return;
    }
  }

  async getExternalRequestBudget(day, scope) {
    const limit = EXTERNAL_REQUEST_LIMITS[scope];
    if (!isValidUtcDay(day) || !Number.isSafeInteger(limit)) return { ok: false, error: "external_request_budget_input_invalid" };
    const row = readRow(this.sql, "SELECT used FROM external_request_budgets WHERE budget_day = ? AND scope = ?", day, scope);
    const used = row?.used ?? 0;
    return { ok: true, day, scope, used, limit, remaining: Math.max(0, limit - used) };
  }

  async consumeExternalRequestBudget(day, scope, now = this.requestTime()) {
    const limit = EXTERNAL_REQUEST_LIMITS[scope];
    if (!isValidUtcDay(day) || !Number.isSafeInteger(limit) || !Number.isSafeInteger(now) || now < 0) {
      return { ok: false, error: "external_request_budget_input_invalid" };
    }
    const consumed = readRow(this.sql,
      "INSERT INTO external_request_budgets (budget_day,scope,used,updated_at) VALUES (?,?,1,?) ON CONFLICT(budget_day,scope) DO UPDATE SET used = external_request_budgets.used + 1, updated_at = excluded.updated_at WHERE external_request_budgets.used < ? RETURNING used",
      day, scope, now, limit,
    );
    if (consumed) return { ok: true, allowed: true, day, scope, used: consumed.used, limit, remaining: Math.max(0, limit - consumed.used) };
    const current = readRow(this.sql, "SELECT used FROM external_request_budgets WHERE budget_day = ? AND scope = ?", day, scope);
    const used = current?.used ?? 0;
    return { ok: true, allowed: false, day, scope, used, limit, remaining: 0 };
  }
  limits() {
    return {
      daily: boundedLimit(this.env.RUNTIME_MAX_TASKS_PER_DAY, DEFAULT_LIMITS.daily, DEFAULT_LIMITS.daily),
      concurrent: boundedLimit(this.env.RUNTIME_MAX_CONCURRENT_TASKS, DEFAULT_LIMITS.concurrent, DEFAULT_LIMITS.concurrent),
      payloadBytes: DEFAULT_LIMITS.payloadBytes,
    };
  }

  controlState() {
    const row = readRow(this.sql, "SELECT paused, changed_at, version FROM runtime_control WHERE singleton_id = 1");
    if (!row) throw new Error("runtime_control_missing");
    const failureCount = readRow(this.sql,
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'task.terminal_failure' AND occurred_at >= ?",
      Date.now() - CIRCUIT_BREAKER.windowMs,
    )?.count ?? 0;
    return {
      paused: row.paused === 1,
      changedAt: row.changed_at,
      version: row.version,
      failureCountLast10m: failureCount,
      circuitBreakerThreshold: CIRCUIT_BREAKER.threshold,
      circuitBreakerWindowMs: CIRCUIT_BREAKER.windowMs,
    };
  }

  async consumeOidcJti(body, now) {
    if (!isObject(body) || Object.keys(body).length !== 2 ||
        typeof body.jti !== "string" || !/^[a-zA-Z0-9._:-]{16,128}$/.test(body.jti) ||
        typeof body.expiresAt !== "string" || !/^[0-9]{1,12}$/.test(body.expiresAt)) {
      return { status: 400, body: { ok: false, error: "oidc_replay_request_invalid" } };
    }
    const expiresAtSeconds = Number(body.expiresAt);
    const tokenExpiresAt = expiresAtSeconds * 1000;
    if (!Number.isSafeInteger(expiresAtSeconds) || !Number.isSafeInteger(tokenExpiresAt) ||
        tokenExpiresAt <= now || tokenExpiresAt > now + 11 * 60 * 1000) {
      return { status: 400, body: { ok: false, error: "oidc_replay_expiry_invalid" } };
    }
    try {
      const jtiHash = await sha256Hex(body.jti);
      const retentionUntil = tokenExpiresAt + 24 * 60 * 60 * 1000;
      return this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM oidc_jti_replay WHERE jti_hash IN (SELECT jti_hash FROM oidc_jti_replay WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)", now);
        const existing = readRow(this.sql, "SELECT jti_hash FROM oidc_jti_replay WHERE jti_hash = ?", jtiHash);
        if (existing) return { status: 409, body: { ok: false, error: "oidc_token_replayed" } };
        this.sql.exec("INSERT INTO oidc_jti_replay (jti_hash, expires_at, consumed_at) VALUES (?,?,?)", jtiHash, retentionUntil, now);
        return { status: 200, body: { ok: true, consumed: true } };
      });
    } catch {
      return { status: 503, body: { ok: false, error: "oidc_replay_store_unavailable" } };
    }
  }

  setPaused(paused, body, now) {
    if (!isObject(body) || Object.keys(body).some((key) => !["reason", "actor", "requestId"].includes(key)) ||
        typeof body.actor !== "string" || !/^[a-zA-Z0-9._:-]{3,64}$/.test(body.actor) ||
        typeof body.requestId !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestId) ||
        (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 160 ||
          [...body.reason].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)))) {
      return { status: 400, body: { ok: false, error: "runtime_control_request_invalid" } };
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        const rate = readRow(this.sql, "SELECT window_started_at, request_count FROM runtime_control_rate_limit WHERE actor = ?", body.actor);
        const windowStart = rate && now - rate.window_started_at < 60_000 ? rate.window_started_at : now;
        const requestCount = rate && windowStart === rate.window_started_at ? rate.request_count : 0;
        if (requestCount >= 10) return { status: 429, body: { ok: false, error: "runtime_control_rate_limited" } };
        this.sql.exec("INSERT INTO runtime_control_rate_limit (actor, window_started_at, request_count) VALUES (?,?,1) ON CONFLICT(actor) DO UPDATE SET window_started_at=excluded.window_started_at, request_count=?",
          body.actor, windowStart, requestCount + 1);
        const current = readRow(this.sql, "SELECT paused, changed_at, version FROM runtime_control WHERE singleton_id = 1");
        if (!current) return { status: 503, body: { ok: false, error: "runtime_control_unavailable" } };
        const cancelRunningTasks = () => {
          const running = this.sql.exec(
            "SELECT task_id, task_type, lease_generation FROM tasks WHERE state='running'",
          ).toArray();
          this.sql.exec(
            "UPDATE tasks SET state='cancelled', updated_at=?, terminal_at=?, error_code='operator_paused', lease_owner=NULL, lease_expires_at=NULL, lease_max_expires_at=NULL, next_attempt_at=NULL, last_error_code='operator_paused' WHERE state='running'",
            now, now,
          );
          for (const task of running) {
            this.audit(task.task_id, "task.cancelled", now, {
              taskType: task.task_type,
              leaseGeneration: task.lease_generation,
              reason: "operator_paused",
            });
          }
        };
        if (current.paused === (paused ? 1 : 0)) {
          // Repeated Pause is idempotent but still repairs any stale running
          // lease left by an earlier runtime version or interrupted rollout.
          if (paused) cancelRunningTasks();
          return { status: 200, body: { ok: true, changed: false, control: this.controlState() } };
        }
        const version = current.version + 1;
        this.sql.exec("UPDATE runtime_control SET paused = ?, changed_at = ?, version = ? WHERE singleton_id = 1 AND version = ?",
          paused ? 1 : 0, now, version, current.version);
        const updated = this.controlState();
        if (updated.version !== version || updated.paused !== paused) {
          return { status: 409, body: { ok: false, error: "runtime_control_conflict" } };
        }
        this.sql.exec("INSERT INTO runtime_control_audit (event_id, action, occurred_at, actor, reason, request_id) VALUES (?,?,?,?,?,?)",
          crypto.randomUUID(), paused ? "pause" : "resume", now, body.actor, body.reason ?? "", body.requestId);

        // Emergency pause atomically fences every in-flight lease. The worker's
        // next heartbeat observes the cancelled lease and aborts cooperative work.
        if (paused) cancelRunningTasks();
        return { status: 200, body: { ok: true, changed: true, control: updated } };
      });
    } catch {
      return { status: 503, body: { ok: false, error: "runtime_control_unavailable" } };
    }
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
        if (this.controlState().paused) return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
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

  async claim(body, now) {
    if (this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED !== "false") {
      return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
    }
    if (!isObject(body) || Object.keys(body).length !== 1 ||
        typeof body.taskId !== "string" || body.taskId.length < 1 || body.taskId.length > 64) {
      return { status: 400, body: { ok: false, error: "claim_request_invalid" } };
    }
    try {
      const result = this.ctx.storage.transactionSync(() => {
        if (this.controlState().paused) return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
        const row = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!row) return { status: 404, body: { ok: false, error: "task_not_found" } };
        const leaseOwner = crypto.randomUUID();
        const decision = claimQueuedTask(row, { now, leaseOwner });
        if (!decision.ok) {
          const status = decision.error === "lease_state_invalid" || decision.error === "lease_owner_invalid" ? 400 : 409;
          return { status, body: { ok: false, error: decision.error } };
        }
        const fields = decision.fields;
        this.sql.exec(
          "UPDATE tasks SET state=?,attempt_count=?,lease_generation=?,lease_owner=?,lease_expires_at=?,lease_max_expires_at=?,next_attempt_at=?,updated_at=? WHERE task_id=? AND state='queued' AND attempt_count=? AND lease_generation=?",
          fields.state, fields.attempt_count, fields.lease_generation, fields.lease_owner,
          fields.lease_expires_at, fields.lease_max_expires_at, fields.next_attempt_at, fields.updated_at,
          body.taskId, row.attempt_count, row.lease_generation,
        );
        const updated = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!updated || updated.state !== "running" || updated.lease_owner !== leaseOwner ||
            updated.lease_generation !== fields.lease_generation) {
          return { status: 409, body: { ok: false, error: "task_claim_conflict" } };
        }
        this.audit(body.taskId, "task.claimed", now, {
          attempt: updated.attempt_count,
          leaseGeneration: updated.lease_generation,
        });
        return {
          status: 200,
          body: {
            ok: true,
            task: safeTask(updated),
            lease: { owner: updated.lease_owner, generation: updated.lease_generation, expiresAt: updated.lease_expires_at, maxExpiresAt: updated.lease_max_expires_at },
          },
        };
      });
      if (result.status === 200) await this.scheduleRecoveryAlarm(now);
      return result;
    } catch {
      return { status: 503, body: { ok: false, error: "state_store_unavailable" } };
    }
  }


  async claimNext(body, now) {
    if (this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED !== "false") {
      return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
    }
    if (!isObject(body) || Object.keys(body).length !== 0) {
      return { status: 400, body: { ok: false, error: "claim_next_request_invalid" } };
    }
    try {
      const result = this.ctx.storage.transactionSync(() => {
        if (this.controlState().paused) {
          return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
        }
        const row = readRow(this.sql,
          "SELECT * FROM tasks WHERE state='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY COALESCE(next_attempt_at,created_at),created_at,task_id LIMIT 1",
          now,
        );
        if (!row) return { status: 200, body: { ok: true, task: null, lease: null } };
        const leaseOwner = crypto.randomUUID();
        const decision = claimQueuedTask(row, { now, leaseOwner });
        if (!decision.ok) {
          const status = decision.error === "lease_state_invalid" || decision.error === "lease_owner_invalid" ? 400 : 409;
          return { status, body: { ok: false, error: decision.error } };
        }
        const fields = decision.fields;
        this.sql.exec(
          "UPDATE tasks SET state=?,attempt_count=?,lease_generation=?,lease_owner=?,lease_expires_at=?,lease_max_expires_at=?,next_attempt_at=?,updated_at=? WHERE task_id=? AND state='queued' AND attempt_count=? AND lease_generation=?",
          fields.state, fields.attempt_count, fields.lease_generation, fields.lease_owner,
          fields.lease_expires_at, fields.lease_max_expires_at, fields.next_attempt_at, fields.updated_at,
          row.task_id, row.attempt_count, row.lease_generation,
        );
        const updated = readRow(this.sql, "SELECT * FROM tasks WHERE task_id=?", row.task_id);
        if (!updated || updated.state !== "running" || updated.lease_owner !== leaseOwner ||
            updated.lease_generation !== fields.lease_generation) {
          return { status: 409, body: { ok: false, error: "task_claim_conflict" } };
        }
        this.audit(row.task_id, "task.claimed", now, {
          attempt: updated.attempt_count,
          leaseGeneration: updated.lease_generation,
          source: "bounded_queue_dispatch",
        });
        return {
          status: 200,
          body: {
            ok: true,
            task: safeTask(updated),
            lease: { owner: updated.lease_owner, generation: updated.lease_generation, expiresAt: updated.lease_expires_at, maxExpiresAt: updated.lease_max_expires_at },
          },
        };
      });
      if (result.status === 200 && result.body.task) await this.scheduleRecoveryAlarm(now);
      return result;
    } catch {
      return { status: 503, body: { ok: false, error: "state_store_unavailable" } };
    }
  }

  heartbeat(body, now) {
    if (!isObject(body) || Object.keys(body).some((key) => !["taskId","leaseOwner","leaseGeneration"].includes(key)) ||
        !Object.hasOwn(body, "taskId") || !Object.hasOwn(body, "leaseOwner") || !Object.hasOwn(body, "leaseGeneration") ||
        typeof body.taskId !== "string" || body.taskId.length < 1 || body.taskId.length > 64) {
      return { status: 400, body: { ok: false, error: "heartbeat_request_invalid" } };
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        const row = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!row) return { status: 404, body: { ok: false, error: "task_not_found" } };
        const decision = heartbeatLease(row, {
          now, leaseOwner: body.leaseOwner, leaseGeneration: body.leaseGeneration,
        });
        if (!decision.ok) return { status: 409, body: { ok: false, error: decision.error } };
        this.sql.exec(
          "UPDATE tasks SET lease_expires_at=?,updated_at=? WHERE task_id=? AND state='running' AND lease_owner=? AND lease_generation=? AND lease_expires_at>?",
          decision.fields.lease_expires_at, decision.fields.updated_at,
          body.taskId, body.leaseOwner, body.leaseGeneration, now,
        );
        this.audit(body.taskId, "task.lease_heartbeat", now, { leaseGeneration: row.lease_generation });
        const updated = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!updated || updated.lease_expires_at !== decision.fields.lease_expires_at) {
          return { status: 409, body: { ok: false, error: "lease_fencing_conflict" } };
        }
        return { status: 200, body: { ok: true, task: safeTask(updated) } };
      });
    } catch {
      return { status: 503, body: { ok: false, error: "state_store_unavailable" } };
    }
  }

  complete(body, now) {
    if (!isObject(body) || Object.keys(body).some((key) => !["taskId","leaseOwner","leaseGeneration","status","errorCode","result"].includes(key)) ||
        !["taskId","leaseOwner","leaseGeneration","status"].every((key) => Object.hasOwn(body, key)) ||
        typeof body.taskId !== "string" || body.taskId.length < 1 || body.taskId.length > 64) {
      return { status: 400, body: { ok: false, error: "complete_request_invalid" } };
    }
    const resultJson = Object.hasOwn(body, "result") ? validatePersistedResult(body.result) : null;
    if (Object.hasOwn(body, "result") && resultJson === null) {
      return { status: 400, body: { ok: false, error: "complete_result_invalid" } };
    }
    if (resultJson !== null && body.status !== "succeeded") {
      return { status: 400, body: { ok: false, error: "complete_result_status_invalid" } };
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        const row = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!row) return { status: 404, body: { ok: false, error: "task_not_found" } };
        const decision = completeLeasedTask(row, {
          now, leaseOwner: body.leaseOwner, leaseGeneration: body.leaseGeneration,
          status: body.status, errorCode: body.errorCode,
        });
        if (!decision.ok) return { status: 409, body: { ok: false, error: decision.error } };
        if (decision.duplicate) {
          const resultConflict = resultJson !== null && resultJson !== row.result_json;
          const errorConflict = Object.hasOwn(body, "errorCode") && body.errorCode !== row.error_code;
          if (resultConflict || errorConflict) {
            return { status: 409, body: { ok: false, error: "completion_conflict" } };
          }
          return { status: 200, body: { ok: true, duplicate: true, task: safeTask(row) } };
        }
        const fields = decision.fields;
        this.sql.exec(
          "UPDATE tasks SET state=?,updated_at=?,terminal_at=?,error_code=?,lease_owner=NULL,lease_expires_at=NULL,lease_max_expires_at=NULL,next_attempt_at=NULL,last_error_code=?,result_json=? WHERE task_id=? AND state='running' AND lease_owner=? AND lease_generation=? AND lease_expires_at>?",
          fields.state, fields.updated_at, fields.terminal_at, fields.error_code,
          fields.error_code, resultJson, body.taskId, body.leaseOwner, body.leaseGeneration, now,
        );
        const updated = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!updated || updated.state !== fields.state || updated.lease_owner !== null) {
          return { status: 409, body: { ok: false, error: "lease_fencing_conflict" } };
        }
        this.audit(body.taskId, "task." + fields.state, now, {
          taskType: row.task_type,
          leaseGeneration: row.lease_generation,
        });
        if (fields.state === "failed" && fields.error_code !== "daily_external_request_budget_exhausted") {
          this.audit(body.taskId, "task.terminal_failure", now, { errorCode: fields.error_code });
          this.evaluateCircuitBreaker(body.taskId, now);
        }
        return { status: 200, body: { ok: true, task: safeTask(updated) } };
      });
    } catch {
      return { status: 503, body: { ok: false, error: "state_store_unavailable" } };
    }
  }

  recover(body, now) {
    if (this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED !== "false") {
      return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
    }
    if (!isObject(body) || Object.keys(body).length !== 3 ||
        typeof body.taskId !== "string" || body.taskId.length < 1 || body.taskId.length > 64 ||
        typeof body.actor !== "string" || !/^[a-zA-Z0-9._:-]{3,64}$/.test(body.actor) ||
        typeof body.requestId !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestId)) {
      return { status: 400, body: { ok: false, error: "recover_request_invalid" } };
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        if (this.controlState().paused) return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
        const rate = readRow(this.sql, "SELECT window_started_at, request_count FROM runtime_control_rate_limit WHERE actor = ?", body.actor);
        const windowStart = rate && now - rate.window_started_at < 60_000 ? rate.window_started_at : now;
        const requestCount = rate && windowStart === rate.window_started_at ? rate.request_count : 0;
        if (requestCount >= 10) return { status: 429, body: { ok: false, error: "runtime_control_rate_limited" } };
        this.sql.exec("INSERT INTO runtime_control_rate_limit (actor, window_started_at, request_count) VALUES (?,?,1) ON CONFLICT(actor) DO UPDATE SET window_started_at=excluded.window_started_at, request_count=?",
          body.actor, windowStart, requestCount + 1);
        const row = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!row) return { status: 404, body: { ok: false, error: "task_not_found" } };
        const decision = recoverExpiredLease(row, { now });
        if (!decision.ok) return { status: 409, body: { ok: false, error: decision.error } };
        const fields = decision.fields;
        this.sql.exec(
          "UPDATE tasks SET state=?,updated_at=?,terminal_at=?,error_code=?,lease_owner=NULL,lease_expires_at=NULL,lease_max_expires_at=NULL,next_attempt_at=?,last_error_code=? WHERE task_id=? AND state='running' AND lease_generation=? AND lease_expires_at<=?",
          fields.state, fields.updated_at, fields.terminal_at, fields.error_code,
          fields.next_attempt_at, fields.last_error_code, body.taskId, row.lease_generation, now,
        );
        const updated = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!updated || updated.state !== fields.state || updated.lease_owner !== null) {
          return { status: 409, body: { ok: false, error: "lease_recovery_conflict" } };
        }
        this.audit(body.taskId, decision.outcome === "failed" ? "task.lease_expired_failed" : "task.lease_expired_requeued", now, {
          attempt: row.attempt_count,
          leaseGeneration: row.lease_generation,
          actor: body.actor,
          requestId: body.requestId,
        });
        if (decision.outcome === "failed") {
          this.audit(body.taskId, "task.terminal_failure", now, { errorCode: fields.error_code });
          this.evaluateCircuitBreaker(body.taskId, now);
        }
        return { status: 200, body: { ok: true, outcome: decision.outcome, task: safeTask(updated) } };
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
    if (next === "running") return { status: 409, body: { ok: false, error: "lease_required" } };
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
        if (row.state === "running") return { status: 409, body: { ok: false, error: "lease_required" } };
        const allowed = row.state === "queued" ? ["cancelled"] : [];
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

  evaluateCircuitBreaker(taskId, now) {
    const countRow = readRow(this.sql,
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'task.terminal_failure' AND occurred_at >= ?",
      now - CIRCUIT_BREAKER.windowMs,
    );
    const failureCount = countRow?.count ?? 0;
    if (failureCount < CIRCUIT_BREAKER.threshold) return;

    const current = readRow(this.sql, "SELECT paused, version FROM runtime_control WHERE singleton_id = 1");
    if (!current || current.paused === 1) return;
    const nextVersion = current.version + 1;
    this.sql.exec(
      "UPDATE runtime_control SET paused = 1, changed_at = ?, version = ? WHERE singleton_id = 1 AND paused = 0 AND version = ?",
      now, nextVersion, current.version,
    );
    const updated = readRow(this.sql, "SELECT paused, version FROM runtime_control WHERE singleton_id = 1");
    if (!updated || updated.paused !== 1 || updated.version !== nextVersion) return;

    this.sql.exec(
      "INSERT INTO runtime_control_audit (event_id, action, occurred_at, actor, reason, request_id) VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(), "pause", now, "system:circuit_breaker",
      "circuit_breaker:5_failures_in_10m", crypto.randomUUID(),
    );
    this.audit(taskId, "runtime.circuit_breaker_auto_pause", now, {
      failureCount,
      threshold: CIRCUIT_BREAKER.threshold,
      windowMs: CIRCUIT_BREAKER.windowMs,
    });
  }

  audit(taskId, eventType, now, metadata) {
    this.sql.exec("INSERT INTO audit_events (event_id,task_id,event_type,occurred_at,metadata_json) VALUES (?,?,?,?,?)",
      crypto.randomUUID(), taskId, eventType, now, JSON.stringify(metadata));
  }

  prune(now) {
    const taskCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const auditCutoff = now - 90 * 24 * 60 * 60 * 1000;
    const boundedDelete = (table, key, predicate, cutoff) => this.sql.exec(
      `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE ${predicate} ORDER BY ${key} LIMIT 100)`,
      cutoff
    );
    // Keep each admission-triggered cleanup bounded. A large stale backlog is
    // drained over subsequent reservations instead of monopolizing one DO turn.
    boundedDelete("tasks", "task_id", "state IN ('succeeded','failed','cancelled') AND terminal_at < ?", taskCutoff);
    boundedDelete("audit_events", "event_id", "occurred_at < ?", auditCutoff);
    boundedDelete("runtime_control_audit", "event_id", "occurred_at < ?", auditCutoff);
    boundedDelete("runtime_control_rate_limit", "actor", "window_started_at < ?", now - 24 * 60 * 60 * 1000);
    boundedDelete("daily_usage", "day_utc", "day_utc < ?", utcDay(auditCutoff));
    this.sql.exec("DELETE FROM external_request_budgets WHERE rowid IN (SELECT rowid FROM external_request_budgets WHERE budget_day < ? ORDER BY budget_day LIMIT 100)", utcDay(now - 30 * 24 * 60 * 60 * 1000));
  }
}
