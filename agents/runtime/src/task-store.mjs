import { DurableObject } from "cloudflare:workers";

const TASK_TYPES = new Set([
  "ai_bank_discovery",
  "content_research",
  "content_draft",
  "quality_review",
  "runtime_health_check"
]);
const MAX_PAYLOAD_BYTES = 8192;
const MAX_ACTIVE_TASKS = 500;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;

function validatePayload(type, payload) {
  const keys = Object.keys(payload);
  const text = (value, min, max) =>
    typeof value === "string" && value.trim().length >= min && value.length <= max;
  const id = value => typeof value === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(value);
  const allowed = {
    ai_bank_discovery: ["query"],
    content_research: ["topic", "language"],
    content_draft: ["topic", "research_task_id"],
    quality_review: ["artifact_id", "artifact_type"],
    runtime_health_check: []
  }[type];
  if (keys.some(key => !allowed.includes(key))) return false;
  if (type === "ai_bank_discovery") return text(payload.query, 3, 160);
  if (type === "content_research") {
    return text(payload.topic, 5, 200) &&
      (payload.language === undefined || payload.language === "vi");
  }
  if (type === "content_draft") return text(payload.topic, 5, 200) && id(payload.research_task_id);
  if (type === "quality_review") {
    return id(payload.artifact_id) && ["article", "ai_tool"].includes(payload.artifact_type);
  }
  if (type === "runtime_health_check") return keys.length === 0;
  return false;
}

function safeTask(row) {
  return {
    id: row.id,
    task_type: row.task_type,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    attempts: row.attempts,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lease_until: row.lease_until,
    last_error: row.last_error,
    result: row.result_json ? JSON.parse(row.result_json) : null
  };
}

export class AgentTaskStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','leased','completed','dead')),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        lease_until INTEGER,
        lease_token TEXT,
        last_error TEXT,
        result_json TEXT
      )
    `);
    const columns = this.ctx.storage.sql.exec("PRAGMA table_info(tasks)").toArray();
    if (!columns.some(column => column.name === "result_json")) {
      this.ctx.storage.sql.exec("ALTER TABLE tasks ADD COLUMN result_json TEXT");
    }
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS tasks_status_created ON tasks(status, created_at)"
    );
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS external_request_budgets (
        budget_day TEXT NOT NULL,
        scope TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (budget_day, scope)
      )
    `);
  }

  enqueue(task) {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new TypeError("invalid_task");
    }
    if (!TASK_TYPES.has(task.task_type)) throw new TypeError("task_type_not_allowed");
    if (typeof task.id !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(task.id)) {
      throw new TypeError("invalid_task_id");
    }
    if (!task.payload || typeof task.payload !== "object" || Array.isArray(task.payload) ||
        !validatePayload(task.task_type, task.payload)) {
      throw new TypeError("invalid_payload");
    }
    const payloadJson = JSON.stringify(task.payload);
    if (new TextEncoder().encode(payloadJson).byteLength > MAX_PAYLOAD_BYTES) {
      throw new TypeError("payload_too_large");
    }

    const existing = this.ctx.storage.sql.exec(
      "SELECT * FROM tasks WHERE id = ?", task.id
    ).toArray()[0];
    if (existing) {
      const sameRequest = existing.task_type === task.task_type &&
        existing.payload_json === payloadJson;
      return sameRequest
        ? { accepted: true, duplicate: true, task: safeTask(existing) }
        : { accepted: false, reason: "idempotency_key_conflict" };
    }

    const active = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) AS count FROM tasks WHERE status IN ('pending','leased')"
    ).one().count;
    if (active >= MAX_ACTIVE_TASKS) {
      return { accepted: false, reason: "queue_capacity_reached" };
    }

    const now = Date.now();
    const inserted = this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO tasks
       (id, task_type, payload_json, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
      task.id, task.task_type, payloadJson, now, now
    );
    const row = this.ctx.storage.sql.exec(
      "SELECT * FROM tasks WHERE id = ?", task.id
    ).one();
    return {
      accepted: true,
      duplicate: inserted.rowsWritten === 0,
      task: safeTask(row)
    };
  }

  claim(allowedTaskTypes = null, taskId = null) {
    const now = Date.now();
    // Expired leases return to the queue; exhausted tasks move to dead-letter state.
    this.ctx.storage.sql.exec(
      "UPDATE tasks SET status = CASE WHEN attempts >= ? THEN 'dead' ELSE 'pending' END, lease_until = NULL, lease_token = NULL, updated_at = ? WHERE status = 'leased' AND lease_until <= ?",
      MAX_ATTEMPTS, now, now
    );
    if (allowedTaskTypes !== null && (!Array.isArray(allowedTaskTypes) || allowedTaskTypes.length === 0 || allowedTaskTypes.some(type => !TASK_TYPES.has(type)))) {
      throw new TypeError("invalid_claim_task_types");
    }
    if (taskId !== null && (typeof taskId !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(taskId))) {
      throw new TypeError("invalid_claim_task_id");
    }
    const typeFilter = allowedTaskTypes === null ? "" : " AND task_type IN (" + allowedTaskTypes.map(() => "?").join(",") + ")";
    const idFilter = taskId === null ? "" : " AND id = ?";
    const row = this.ctx.storage.sql.exec(
      "SELECT * FROM tasks WHERE status = 'pending' AND attempts < ?" + typeFilter + idFilter + " ORDER BY created_at ASC LIMIT 1",
      MAX_ATTEMPTS, ...(allowedTaskTypes ?? []), ...(taskId === null ? [] : [taskId])
    ).toArray()[0];
    if (!row) return { task: null };
    const leaseUntil = now + LEASE_MS;
    const leaseToken = crypto.randomUUID();
    // RETURNING makes lease acquisition atomic and gives this invocation
    // proof that its conditional update actually won the race.
    const claimedRows = this.ctx.storage.sql.exec(
      "UPDATE tasks SET status = 'leased', attempts = attempts + 1, lease_until = ?, lease_token = ?, updated_at = ? WHERE id = ? AND status = 'pending' RETURNING *",
      leaseUntil, leaseToken, now, row.id
    ).toArray();
    if (claimedRows.length !== 1) return { task: null };
    return { task: safeTask(claimedRows[0]), lease_token: leaseToken };
  }

  complete(taskId, leaseToken, result = null) {
    const now = Date.now();
    const resultJson = result === null ? null : JSON.stringify(result);
    if (resultJson && new TextEncoder().encode(resultJson).byteLength > MAX_PAYLOAD_BYTES) throw new TypeError("result_too_large");
    const updated = this.ctx.storage.sql.exec(
      "UPDATE tasks SET status = 'completed', lease_until = NULL, lease_token = NULL, updated_at = ?, result_json = ? WHERE id = ? AND status = 'leased' AND lease_until > ? AND lease_token = ? RETURNING id",
      now, resultJson, taskId, now, leaseToken
    ).toArray();
    return { updated: updated.length === 1 };
  }

  retry(taskId, leaseToken, errorCode = "task_failed") {
    const now = Date.now();
    const safeError = String(errorCode).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80);
    const row = this.ctx.storage.sql.exec("SELECT * FROM tasks WHERE id = ?", taskId).toArray()[0];
    if (!row || row.status !== "leased" || row.lease_until <= now || row.lease_token !== leaseToken) return { updated: false };
    const status = row.attempts >= MAX_ATTEMPTS ? "dead" : "pending";
    const updated = this.ctx.storage.sql.exec(
      "UPDATE tasks SET status = ?, lease_until = NULL, lease_token = NULL, updated_at = ?, last_error = ? WHERE id = ? AND status = 'leased' AND lease_until > ? AND lease_token = ? RETURNING id",
      status, now, safeError, taskId, now, leaseToken
    ).toArray();
    return { updated: updated.length === 1, status: updated.length === 1 ? status : undefined };
  }

  consumeExternalRequestBudget(day, scope) {
    const limits = { ai_bank_discovery: 10, content_research: 8 };
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        new Date(day + "T00:00:00.000Z").toISOString().slice(0, 10) !== day ||
        !Object.hasOwn(limits, scope)) {
      throw new TypeError("invalid_external_request_budget");
    }

    const cutoff = new Date(Date.parse(day + "T00:00:00.000Z") - 30 * 86_400_000)
      .toISOString().slice(0, 10);
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "DELETE FROM external_request_budgets WHERE budget_day < ?", cutoff
    );

    const limit = limits[scope];
    const consumed = this.ctx.storage.sql.exec(
      `INSERT INTO external_request_budgets (budget_day, scope, used, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT (budget_day, scope) DO UPDATE
       SET used = used + 1, updated_at = excluded.updated_at
       WHERE used < ?
       RETURNING used`,
      day, scope, now, limit
    ).toArray();

    if (consumed.length === 1) {
      const used = consumed[0].used;
      return { allowed: true, day, scope, used, limit, remaining: limit - used };
    }
    const current = this.ctx.storage.sql.exec(
      "SELECT used FROM external_request_budgets WHERE budget_day = ? AND scope = ?",
      day, scope
    ).one();
    return {
      allowed: false,
      day,
      scope,
      used: current.used,
      limit,
      remaining: 0,
      reason: "daily_external_request_budget_exhausted"
    };
  }

  pruneTerminalTasks(now = Date.now()) {
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("invalid_retention_timestamp");
    const completedBefore = now - 24 * 60 * 60 * 1000;
    const deadBefore = now - 7 * 24 * 60 * 60 * 1000;
    const completed = this.ctx.storage.sql.exec(
      "DELETE FROM tasks WHERE status = 'completed' AND updated_at < ? RETURNING id",
      completedBefore
    ).toArray().length;
    const dead = this.ctx.storage.sql.exec(
      "DELETE FROM tasks WHERE status = 'dead' AND updated_at < ? RETURNING id",
      deadBefore
    ).toArray().length;
    const budgetCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const budgets = this.ctx.storage.sql.exec(
      "DELETE FROM external_request_budgets WHERE budget_day < ? RETURNING budget_day",
      budgetCutoff
    ).toArray().length;
    return { completed_deleted: completed, dead_deleted: dead, budget_days_deleted: budgets };
  }

  stats() {
    const rows = this.ctx.storage.sql.exec(
      "SELECT status, COUNT(*) AS count FROM tasks GROUP BY status"
    ).toArray();
    return Object.fromEntries(rows.map(row => [row.status, row.count]));
  }
}
