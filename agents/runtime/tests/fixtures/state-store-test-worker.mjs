import worker from "../../src/worker.mjs";
import { AgentStateStore } from "../../src/state-store.mjs";
import { hasValidStateStoreBearer } from "../../src/internal-auth.mjs";

const TASK_TYPES_SQL = "'content.review','ai_bank.candidate_review','seo.audit'";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }});
}

/**
 * Test-only Durable Object subclass. This module lives under tests/fixtures and
 * is referenced only by the Miniflare integration harness, never by wrangler.
 */
export class AgentStateStoreTestFixture extends AgentStateStore {
  requestTime(request) {
    const value = request.headers.get("x-test-now");
    if (value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/__test/audit") {
      if (!await hasValidStateStoreBearer(request, this.env)) {
        return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
      }
      const taskId = url.searchParams.get("taskId");
      if (!taskId || taskId.length > 64 || url.searchParams.getAll("taskId").length !== 1 ||
          [...url.searchParams.keys()].some((key) => key !== "taskId")) {
        return jsonResponse({ ok: false, error: "test_audit_query_invalid" }, 400);
      }
      try {
        await this.ready;
        const events = this.sql.exec(
          "SELECT event_type, occurred_at, metadata_json FROM audit_events WHERE task_id = ? ORDER BY occurred_at DESC LIMIT 20",
          taskId,
        ).toArray().map((row) => ({
          eventType: row.event_type,
          occurredAt: row.occurred_at,
          metadata: JSON.parse(row.metadata_json),
        }));
        return jsonResponse({ ok: true, events });
      } catch {
        return jsonResponse({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    if (url.pathname === "/__test/retention-counts" && request.method === "GET") {
      if (!await hasValidStateStoreBearer(request, this.env)) {
        return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
      }
      try {
        await this.ready;
        const now = this.requestTime(request);
        const taskCutoff = now - 30 * 24 * 60 * 60 * 1000;
        const auditCutoff = now - 90 * 24 * 60 * 60 * 1000;
        const dailyCutoff = new Date(auditCutoff).toISOString().slice(0, 10);
        const count = (sql, ...args) => this.sql.exec(sql, ...args).toArray()[0]?.count ?? 0;
        return jsonResponse({
          ok: true,
          expiredTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE state IN ('succeeded','failed','cancelled') AND terminal_at < ?", taskCutoff),
          runningTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE state='running'"),
          recentTerminalTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE state IN ('succeeded','failed','cancelled') AND terminal_at >= ?", taskCutoff),
          expiredAuditEvents: count("SELECT COUNT(*) AS count FROM audit_events WHERE occurred_at < ?", auditCutoff),
          expiredControlAudit: count("SELECT COUNT(*) AS count FROM runtime_control_audit WHERE occurred_at < ?", auditCutoff),
          expiredRateLimits: count("SELECT COUNT(*) AS count FROM runtime_control_rate_limit WHERE window_started_at < ?", now - 24 * 60 * 60 * 1000),
          expiredDailyUsage: count("SELECT COUNT(*) AS count FROM daily_usage WHERE day_utc < ?", dailyCutoff),
        });
      } catch {
        return jsonResponse({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    if (url.pathname === "/__test/seed-retention" && request.method === "POST") {
      if (!await hasValidStateStoreBearer(request, this.env)) {
        return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
      }
      try {
        await this.ready;
        const now = this.requestTime(request);
        const day = 24 * 60 * 60 * 1000;
        this.ctx.storage.transactionSync(() => {
          for (let i = 0; i < 105; i++) {
            const terminalAt = now - 31 * day - i;
            this.sql.exec(
              "INSERT INTO tasks (task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,error_code,attempt_count,max_attempts,lease_generation) " +
              "VALUES (?,?,?,?,?,2,'succeeded',?,?,?,NULL,0,3,0)",
              "retention-expired-task-" + String(i).padStart(3, "0"),
              "retention-expired-key-" + String(i).padStart(3, "0"),
              "seo.audit", "{}", "retention-fixture-hash",
              terminalAt, terminalAt, terminalAt,
            );
          }
          this.sql.exec(
            "INSERT INTO tasks (task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,attempt_count,max_attempts,lease_generation) " +
            "VALUES (?,?,?,?,?,2,'running',?,?,NULL,1,3,1)",
            "retention-running-sentinel", "retention-running-sentinel-key", "seo.audit", "{}", "retention-fixture-hash",
            now - 40 * day, now - 40 * day,
          );
          this.sql.exec(
            "INSERT INTO tasks (task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,attempt_count,max_attempts,lease_generation) " +
            "VALUES (?,?,?,?,?,2,'succeeded',?,?,?,0,3,0)",
            "retention-recent-sentinel", "retention-recent-sentinel-key", "seo.audit", "{}", "retention-fixture-hash",
            now - day, now - day, now - day,
          );
          for (let i = 0; i < 305; i++) {
            const occurredAt = now - 91 * day - i;
            this.sql.exec(
              "INSERT INTO audit_events (event_id,task_id,event_type,occurred_at,metadata_json) VALUES (?,?,?,?,?)",
              "retention-audit-" + String(i).padStart(3, "0"), "retention-fixture-task", "fixture.retention", occurredAt, "{}",
            );
          }
          for (let i = 0; i < 105; i++) {
            const occurredAt = now - 91 * day - i;
            this.sql.exec(
              "INSERT INTO runtime_control_audit (event_id,action,occurred_at,actor,reason,request_id) VALUES (?,?,?,?,?,?)",
              "retention-control-audit-" + String(i).padStart(3, "0"), "pause", occurredAt,
              "retention-actor-" + i, "fixture", "retention-request-" + i,
            );
            this.sql.exec(
              "INSERT INTO runtime_control_rate_limit (actor,window_started_at,request_count) VALUES (?,?,1)",
              "retention-rate-actor-" + i, now - 25 * 60 * 60 * 1000 - i,
            );
            const dayUtc = new Date(now - (91 + i) * day).toISOString().slice(0, 10);
            this.sql.exec(
              "INSERT INTO daily_usage (day_utc,accepted_count) VALUES (?,1)",
              dayUtc,
            );
          }
        });
        return jsonResponse({ ok: true, seeded: { expiredTasks: 105, expiredAuditEvents: 305, expiredControlAudit: 105, expiredRateLimits: 105, expiredDailyUsage: 105 } });
      } catch {
        return jsonResponse({ ok: false, error: "state_store_unavailable" }, 503);
      }
    }
    if (request.method !== "POST" ||
        (url.pathname !== "/__test/downgrade-v1" && url.pathname !== "/__test/rollback")) {
      return super.fetch(request);
    }
    if (!await hasValidStateStoreBearer(request, this.env)) {
      return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
    }
    try {
      await this.ready;
      if (url.pathname === "/__test/downgrade-v1") {
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("CREATE TABLE tasks_v1_fixture (task_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, task_type TEXT NOT NULL CHECK (task_type IN (" + TASK_TYPES_SQL + ")), payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 1 AND 8192), state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, terminal_at INTEGER, error_code TEXT)");
          this.sql.exec("INSERT INTO tasks_v1_fixture (task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,error_code) SELECT task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,error_code FROM tasks");
          this.sql.exec("DROP TABLE tasks");
          this.sql.exec("ALTER TABLE tasks_v1_fixture RENAME TO tasks");
          this.sql.exec("CREATE INDEX tasks_state_idx ON tasks(state)");
          this.sql.exec("CREATE INDEX tasks_terminal_idx ON tasks(terminal_at)");
          this.sql.exec("DROP TABLE oidc_jti_replay");
          this.sql.exec("DROP TABLE runtime_control_rate_limit");
          this.sql.exec("DROP TABLE runtime_control_audit");
          this.sql.exec("DROP TABLE runtime_control");
          this.sql.exec("UPDATE runtime_meta SET value = '1' WHERE key = 'schema_version'");
        });
        return jsonResponse({ ok: true, schemaVersion: 1 });
      }
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("INSERT INTO daily_usage (day_utc, accepted_count) VALUES ('2099-12-31', 1)");
        throw new Error("intentional_rollback_probe");
      });
      return jsonResponse({ ok: false, error: "rollback_probe_did_not_throw" }, 500);
    } catch (error) {
      if (url.pathname === "/__test/rollback" && error?.message === "intentional_rollback_probe") {
        const usage = this.sql.exec("SELECT accepted_count FROM daily_usage WHERE day_utc = '2099-12-31'").toArray()[0] ?? null;
        return jsonResponse({ ok: true, rolledBack: usage === null, acceptedToday: usage?.accepted_count ?? 0 });
      }
      return jsonResponse({ ok: false, error: "state_store_unavailable" }, 503);
    }
  }
}

export { AgentStateStoreTestFixture as AgentStateStore };
export default worker;
