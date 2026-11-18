import { DurableObject } from "cloudflare:workers";

const TASK_TYPES = new Set([
  "ai_bank_discovery",
  "content_research",
  "content_draft",
  "quality_review"
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
    quality_review: ["artifact_id", "artifact_type"]
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
    last_error: row.last_error
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
        last_error TEXT
      )
    `);
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS tasks_status_created ON tasks(status, created_at)"
    );
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

  claim() {
    const now = Date.now();
    // Expired leases return to the queue; exhausted tasks move to dead-letter state.
    this.ctx.storage.sql.exec(
      "UPDATE tasks SET status = CASE WHEN attempts >= ? THEN 'dead' ELSE 'pending' END, lease_until = NULL, lease_token = NULL, updated_at = ? WHERE status = 'leased' AND lease_until <= ?",
      MAX_ATTEMPTS, now, now
    );
    const row = this.ctx.storage.sql.exec(
      "SELECT * FROM tasks WHERE status = 'pending' AND attempts < ? ORDER BY created_at ASC LIMIT 1",
      MAX_ATTEMPTS
    ).toArray()[0];
    if (!row) return { task: null };
    const leaseUntil = now + LEASE_MS;
    const leaseToken = crypto.randomUUID();
    const updated = this.ctx.storage.sql.exec(
      "UPDATE tasks SET status = 'leased', attempts = attempts + 1, lease_until = ?, lease_token = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      leaseUntil, leaseToken, now, row.id
    );
    // A competing caller may have claimed the selected row first. Never
    // return a lease token unless this invocation actually acquired it.
    const claimed = this.ctx.storage.sql.exec("SELECT * FROM tasks WHERE id = ?", row.id).one();
    if (claimed.status !== "leased" || claimed.lease_token !== leaseToken) {
      return { task: null };
    }
    return { task: safeTask(claimed), lease_token: leaseToken };
  }

  complete(taskId, leaseToken) {
    const now = Date.now();
    const result = this.ctx.storage.sql.exec(
      "UPDATE tasks SET status = 'completed', lease_until = NULL, lease_token = NULL, updated_at = ? WHERE id = ? AND status = 'leased' AND lease_until > ? AND lease_token = ?",
      now, taskId, now, leaseToken
    );
    return { updated: result.rowsWritten === 1 };
  }

  retry(taskId, leaseToken, errorCode = "task_failed") {
    const now = Date.now();
    const safeError = String(errorCode).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80);
    const row = this.ctx.storage.sql.exec("SELECT * FROM tasks WHERE id = ?", taskId).toArray()[0];
    if (!row || row.status !== "leased" || row.lease_until <= now || row.lease_token !== leaseToken) return { updated: false };
    const status = row.attempts >= MAX_ATTEMPTS ? "dead" : "pending";
    const result = this.ctx.storage.sql.exec(
      "UPDATE tasks SET status = ?, lease_until = NULL, lease_token = NULL, updated_at = ?, last_error = ? WHERE id = ? AND status = 'leased' AND lease_until > ? AND lease_token = ?",
      status, now, safeError, taskId, now, leaseToken
    );
    return { updated: result.rowsWritten === 1, status: result.rowsWritten === 1 ? status : undefined };
  }

  stats() {
    const rows = this.ctx.storage.sql.exec(
      "SELECT status, COUNT(*) AS count FROM tasks GROUP BY status"
    ).toArray();
    return Object.fromEntries(rows.map(row => [row.status, row.count]));
  }
}
