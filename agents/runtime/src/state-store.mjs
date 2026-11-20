import { validateTaskRequest } from "./task-contract.mjs";
import { hasValidStateStoreBearer } from "./internal-auth.mjs";
import { claimQueuedTask, heartbeatLease, recoverExpiredLease, completeLeasedTask } from "./lease-policy.mjs";

const SCHEMA_VERSION = 5;
// Conservative Free-tier pilot defaults; hard caps remain enforced below.
const DEFAULT_LIMITS = Object.freeze({ daily: 100, concurrent: 5, payloadBytes: 8192 });
const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);
const TASK_TYPES_SQL = "'content.review','ai_bank.candidate_review','seo.audit'";

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
    attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
    leaseGeneration: row.lease_generation, leaseExpiresAt: row.lease_expires_at, leaseMaxExpiresAt: row.lease_max_expires_at,
    nextAttemptAt: row.next_attempt_at, lastErrorCode: row.last_error_code,
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
        const parsedBody = await readBoundedJsonRequest(request, 1024);
        if (!parsedBody.ok) {
          return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        }
        const result = await this.consumeOidcJti(parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if ((url.pathname === "/control/pause" || url.pathname === "/control/resume") && request.method === "POST") {
        const parsedBody = await readBoundedJsonRequest(request, 16 * 1024);
        if (!parsedBody.ok) {
          return jsonResponse({ ok: false, error: parsedBody.status === 413 ? "request_body_too_large" : "request_invalid" }, parsedBody.status);
        }
        const result = this.setPaused(url.pathname.endsWith("/pause"), parsedBody.value, this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/reserve" && request.method === "POST") {
        const result = await this.reserve(await request.json(), this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/claim" && request.method === "POST") {
        const result = this.claim(await request.json(), this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/heartbeat" && request.method === "POST") {
        const result = this.heartbeat(await request.json(), this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/complete" && request.method === "POST") {
        const result = this.complete(await request.json(), this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/recover" && request.method === "POST") {
        const result = this.recover(await request.json(), this.requestTime(request));
        return jsonResponse(result.body, result.status);
      }
      if (url.pathname === "/transition" && request.method === "POST") {
        const result = this.transition(await request.json(), this.requestTime(request));
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
    return { paused: row.paused === 1, changedAt: row.changed_at, version: row.version };
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
        if (current.paused === (paused ? 1 : 0)) {
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

  claim(body, now) {
    if (this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED !== "false") {
      return { status: 503, body: { ok: false, error: "agent_disabled_or_paused" } };
    }
    if (!isObject(body) || Object.keys(body).length !== 1 ||
        typeof body.taskId !== "string" || body.taskId.length < 1 || body.taskId.length > 64) {
      return { status: 400, body: { ok: false, error: "claim_request_invalid" } };
    }
    try {
      return this.ctx.storage.transactionSync(() => {
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
    if (!isObject(body) || Object.keys(body).some((key) => !["taskId","leaseOwner","leaseGeneration","status","errorCode"].includes(key)) ||
        !["taskId","leaseOwner","leaseGeneration","status"].every((key) => Object.hasOwn(body, key)) ||
        typeof body.taskId !== "string" || body.taskId.length < 1 || body.taskId.length > 64) {
      return { status: 400, body: { ok: false, error: "complete_request_invalid" } };
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
        if (decision.duplicate) return { status: 200, body: { ok: true, duplicate: true, task: safeTask(row) } };
        const fields = decision.fields;
        this.sql.exec(
          "UPDATE tasks SET state=?,updated_at=?,terminal_at=?,error_code=?,lease_owner=NULL,lease_expires_at=NULL,lease_max_expires_at=NULL,next_attempt_at=NULL,last_error_code=? WHERE task_id=? AND state='running' AND lease_owner=? AND lease_generation=? AND lease_expires_at>?",
          fields.state, fields.updated_at, fields.terminal_at, fields.error_code,
          fields.error_code, body.taskId, body.leaseOwner, body.leaseGeneration, now,
        );
        const updated = readRow(this.sql, "SELECT * FROM tasks WHERE task_id = ?", body.taskId);
        if (!updated || updated.state !== fields.state || updated.lease_owner !== null) {
          return { status: 409, body: { ok: false, error: "lease_fencing_conflict" } };
        }
        this.audit(body.taskId, "task." + fields.state, now, {
          taskType: row.task_type,
          leaseGeneration: row.lease_generation,
        });
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

  audit(taskId, eventType, now, metadata) {
    this.sql.exec("INSERT INTO audit_events (event_id,task_id,event_type,occurred_at,metadata_json) VALUES (?,?,?,?,?)",
      crypto.randomUUID(), taskId, eventType, now, JSON.stringify(metadata));
  }

  prune(now) {
    const taskCutoff = now - 30 * 24 * 60 * 60 * 1000;
    const auditCutoff = now - 90 * 24 * 60 * 60 * 1000;
    this.sql.exec("DELETE FROM tasks WHERE state IN ('succeeded','failed','cancelled') AND terminal_at < ?", taskCutoff);
    this.sql.exec("DELETE FROM audit_events WHERE occurred_at < ?", auditCutoff);
    this.sql.exec("DELETE FROM runtime_control_audit WHERE occurred_at < ?", auditCutoff);
    this.sql.exec("DELETE FROM runtime_control_rate_limit WHERE window_started_at < ?", now - 24 * 60 * 60 * 1000);
    this.sql.exec("DELETE FROM daily_usage WHERE day_utc < ?", utcDay(auditCutoff));
  }
}
