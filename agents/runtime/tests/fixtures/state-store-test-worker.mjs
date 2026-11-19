import worker from "../../src/worker.mjs";
import { AgentStateStore } from "../../src/state-store.mjs";
import { hasValidStateStoreBearer } from "../../src/internal-auth.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Test-only Durable Object subclass. This module is loaded only by Miniflare.
class TestAgentStateStore extends AgentStateStore {
  requestTime(request) {
    const value = request?.headers?.get("x-test-now");
    if (value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const testPaths = ["/__test/downgrade-v1", "/__test/rollback", "/__test/snapshot"];
    if (!testPaths.includes(url.pathname)) return super.fetch(request);
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    if (!await hasValidStateStoreBearer(request, this.env)) {
      return json({ ok: false, error: "state_store_auth_required" }, 401);
    }
    await this.ready;
    if (url.pathname === "/__test/snapshot") {
      const row = this.sql.exec("SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM daily_usage) AS dailyUsage, (SELECT COUNT(*) FROM audit_events) AS auditEvents, (SELECT COUNT(*) FROM tasks WHERE lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL OR lease_max_expires_at IS NOT NULL) AS leases, (SELECT COUNT(*) FROM runtime_control_audit) AS controlAuditEvents, (SELECT COUNT(*) FROM runtime_control_rate_limit) AS controlRateLimits").toArray()[0];
      return json({ ok: true, counts: row });
    }
    if (url.pathname === "/__test/downgrade-v1") {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("CREATE TABLE tasks_v1_fixture (task_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, task_type TEXT NOT NULL CHECK (task_type IN ('content.review','ai_bank.candidate_review','seo.audit')), payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 1 AND 8192), state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, terminal_at INTEGER, error_code TEXT)");
        this.sql.exec("INSERT INTO tasks_v1_fixture (task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,error_code) SELECT task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,error_code FROM tasks");
        this.sql.exec("DROP TABLE tasks");
        this.sql.exec("ALTER TABLE tasks_v1_fixture RENAME TO tasks");
        this.sql.exec("CREATE INDEX tasks_state_idx ON tasks(state)");
        this.sql.exec("CREATE INDEX tasks_terminal_idx ON tasks(terminal_at)");
        this.sql.exec("DROP TABLE runtime_control_rate_limit");
        this.sql.exec("DROP TABLE runtime_control_audit");
        this.sql.exec("DROP TABLE runtime_control");
        this.sql.exec("UPDATE runtime_meta SET value = '1' WHERE key = 'schema_version'");
      });
      return json({ ok: true, schemaVersion: 1 });
    }
    try {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("INSERT INTO daily_usage (day_utc, accepted_count) VALUES ('2099-12-31', 1)");
        throw new Error("intentional_rollback_probe");
      });
    } catch {
      const usage = this.sql.exec("SELECT accepted_count FROM daily_usage WHERE day_utc = '2099-12-31'").toArray()[0] ?? null;
      return json({ ok: true, rolledBack: usage === null, acceptedToday: usage?.accepted_count ?? 0 });
    }
    return json({ ok: false, error: "rollback_probe_did_not_throw" }, 500);
  }
}

export { TestAgentStateStore as AgentStateStore };
export default worker;
