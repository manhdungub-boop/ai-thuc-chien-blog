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
