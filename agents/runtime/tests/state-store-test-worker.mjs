import worker, { AgentStateStore } from "../src/worker.mjs";
import { hasValidStateStoreBearer } from "../src/internal-auth.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Test-only Durable Object subclass. This module is loaded by Miniflare tests,
 * never by the checked-in Wrangler entrypoint. Test clocks and rollback probes
 * therefore cannot be enabled through a deployed Worker environment variable.
 */
export class TestAgentStateStore extends AgentStateStore {
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
    if (!["/__test/rollback", "/__test/downgrade-v1", "/__test/prune", "/__test/alarm-state", "/__test/expire-and-fire", "/__test/fire-alarm"].includes(url.pathname)) {
      return super.fetch(request);
    }
    if (url.pathname === "/__test/alarm-state" ? request.method !== "GET" : request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }
    if (!await hasValidStateStoreBearer(request, this.env)) {
      return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
    }

    try {
      await this.ready;
      if (url.pathname === "/__test/prune") {
        const body = await request.json();
        if (!body || !Number.isSafeInteger(body.now) || body.now < 0) return jsonResponse({ ok: false, error: "test_prune_time_invalid" }, 400);
        this.prune(body.now);
        return jsonResponse({ ok: true });
      }
      if (url.pathname === "/__test/alarm-state" && request.method === "GET") {
        return jsonResponse({ ok: true, alarmAt: await this.ctx.storage.getAlarm() });
      }
      if (url.pathname === "/__test/expire-and-fire" && request.method === "POST") {
        const body = await request.json();
        if (!body || typeof body.taskId !== "string" || body.taskId.length > 64) {
          return jsonResponse({ ok: false, error: "test_task_id_invalid" }, 400);
        }
        this.sql.exec("UPDATE tasks SET lease_expires_at=? WHERE task_id=? AND state='running'", Date.now() - 1, body.taskId);
        await this.alarm();
        const row = this.sql.exec("SELECT state, next_attempt_at, lease_owner FROM tasks WHERE task_id=?", body.taskId).toArray()[0] ?? null;
        return jsonResponse({ ok: true, task: row, alarmAt: await this.ctx.storage.getAlarm() });
      }
      if (url.pathname === "/__test/fire-alarm" && request.method === "POST") {
        await this.alarm();
        return jsonResponse({ ok: true, alarmAt: await this.ctx.storage.getAlarm() });
      }
      if (url.pathname === "/__test/downgrade-v1") {
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("CREATE TABLE tasks_v1_fixture (task_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, task_type TEXT NOT NULL CHECK (task_type IN ('content.review','ai_bank.candidate_review','seo.audit')), payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 1 AND 8192), state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, terminal_at INTEGER, error_code TEXT)");
          this.sql.exec("INSERT INTO tasks_v1_fixture (task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,error_code) SELECT task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at,error_code FROM tasks");
          this.sql.exec("DROP TABLE tasks");
          this.sql.exec("ALTER TABLE tasks_v1_fixture RENAME TO tasks");
          this.sql.exec("CREATE INDEX tasks_state_idx ON tasks(state)");
          this.sql.exec("CREATE INDEX tasks_terminal_idx ON tasks(terminal_at)");
          this.sql.exec("DROP TABLE external_request_budgets");
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
    } catch {
      if (url.pathname === "/__test/rollback") {
        const usage = this.sql.exec(
          "SELECT accepted_count FROM daily_usage WHERE day_utc = '2099-12-31'"
        ).toArray()[0] ?? null;
        return jsonResponse({
          ok: true,
          rolledBack: usage === null,
          acceptedToday: usage?.accepted_count ?? 0,
        });
      }
      return jsonResponse({ ok: false, error: "test_fixture_operation_failed" }, 500);
    }
    return jsonResponse({ ok: false, error: "rollback_probe_did_not_throw" }, 500);
  }
}

export default worker;
