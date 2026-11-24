import { AgentStateStore } from "../src/worker.mjs";
// Preserve the pre-existing Durable Object class export until its namespace is migrated safely.
export { AgentStateStore, AgentStateStore as WorkflowStatusDO };
export { AgentAIBankCandidateStore, AgentDraftStore, AgentReviewerAuthStore } from "../src/worker.mjs";
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
  constructor(ctx, env = {}) {
    // Use a dedicated one-run test secret; never overwrite the Preview runtime secret.
    const faultSuiteMode = { active: false };
    const testEnv = new Proxy({
      ...env,
      AGENT_STATE_STORE_TOKEN: env.AGENT_FAULT_TEST_TOKEN ?? env.AGENT_STATE_STORE_TOKEN,
    }, {
      get(target, property, receiver) {
        // Enable transitions only while the token-gated fault suite is running.
        if (faultSuiteMode.active && property === "AGENT_ENABLED") return "true";
        if (faultSuiteMode.active && property === "AGENT_PAUSED") return "false";
        return Reflect.get(target, property, receiver);
      },
    });
    super(ctx, testEnv);
    this.faultSuiteMode = faultSuiteMode;
  }

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
    if (!["/__test/rollback", "/__test/downgrade-v1", "/__test/prune", "/__test/seed-prune-fixture", "/__test/prune-counts", "/__test/downgrade-v6-budget-only", "/__test/downgrade-v6-result-only", "/__test/schema-state", "/__test/alarm-state", "/__test/expire-and-fire", "/__test/fire-alarm", "/__test/fault-suite"].includes(url.pathname)) {
      return super.fetch(request);
    }
    if (url.pathname === "/__test/alarm-state" || url.pathname === "/__test/schema-state" || url.pathname === "/__test/prune-counts" ? request.method !== "GET" : request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }
    if (!await hasValidStateStoreBearer(request, this.env)) {
      return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
    }

    try {
      await this.ready;
      if (url.pathname === "/__test/downgrade-v6-budget-only") {
        this.sql.exec("ALTER TABLE tasks DROP COLUMN result_json");
        this.sql.exec("UPDATE runtime_meta SET value = '6' WHERE key = 'schema_version'");
        return jsonResponse({ ok: true });
      }
      if (url.pathname === "/__test/downgrade-v6-result-only") {
        this.sql.exec("DROP TABLE external_request_budgets");
        this.sql.exec("UPDATE runtime_meta SET value = '6' WHERE key = 'schema_version'");
        return jsonResponse({ ok: true });
      }
      if (url.pathname === "/__test/schema-state" && request.method === "GET") {
        const version = this.sql.exec("SELECT value FROM runtime_meta WHERE key = 'schema_version'").toArray()[0]?.value;
        const columns = this.sql.exec("PRAGMA table_info(tasks)").toArray();
        const budgetTable = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='external_request_budgets'").toArray()[0];
        return jsonResponse({ ok: true, version, hasResultJson: columns.some((column) => column.name === "result_json"), hasExternalRequestBudgets: Boolean(budgetTable) });
      }
      if (url.pathname === "/__test/prune") {
        const body = await request.json();
        if (!body || !Number.isSafeInteger(body.now) || body.now < 0) return jsonResponse({ ok: false, error: "test_prune_time_invalid" }, 400);
        this.prune(body.now);
        return jsonResponse({ ok: true });
      }
      if (url.pathname === "/__test/seed-prune-fixture") {
        const body = await request.json();
        if (!body || !Number.isSafeInteger(body.now) || body.now < 0) return jsonResponse({ ok: false, error: "test_prune_time_invalid" }, 400);
        const day = milliseconds => new Date(milliseconds).toISOString().slice(0, 10);
        this.ctx.storage.transactionSync(() => {
          for (let index = 0; index < 101; index += 1) {
            const id = "prune-fixture-" + String(index).padStart(3, "0");
            this.sql.exec(
              "INSERT INTO tasks (task_id,idempotency_key,task_type,payload_json,payload_hash,payload_bytes,state,created_at,updated_at,terminal_at) VALUES (?,?,?,?,?,?,'succeeded',?,?,?)",
              id, "prune-fixture-key-" + String(index).padStart(3, "0"), "seo.audit", "{}", "fixture-hash", 2,
              body.now - 40 * 86400000, body.now - 40 * 86400000, body.now - 40 * 86400000
            );
            this.sql.exec(
              "INSERT INTO audit_events (event_id,task_id,event_type,occurred_at,metadata_json) VALUES (?,?,?,?,?)",
              "prune-audit-" + String(index).padStart(3, "0"), id, "test.prune", body.now - 100 * 86400000, "{}"
            );
            this.sql.exec(
              "INSERT INTO runtime_control_audit (event_id,action,occurred_at,actor,reason,request_id) VALUES (?,'pause',?,?,?,?)",
              "prune-control-" + String(index).padStart(3, "0"), body.now - 100 * 86400000,
              "test", "retention fixture", "prune-request-" + String(index).padStart(3, "0")
            );
            this.sql.exec(
              "INSERT INTO runtime_control_rate_limit (actor,window_started_at,request_count) VALUES (?,?,1)",
              "prune-actor-" + String(index).padStart(3, "0"), body.now - 2 * 86400000
            );
            this.sql.exec(
              "INSERT INTO daily_usage (day_utc,accepted_count) VALUES (?,1)",
              day(body.now - (100 + index) * 86400000)
            );
            this.sql.exec(
              "INSERT INTO external_request_budgets (budget_day,scope,used,updated_at) VALUES (?,'ai_bank_discovery',1,?)",
              day(body.now - (31 + index) * 86400000), body.now - (31 + index) * 86400000
            );
          }
          for (let index = 101; index < 251; index += 1) {
            this.sql.exec(
              "INSERT INTO audit_events (event_id,task_id,event_type,occurred_at,metadata_json) VALUES (?,?,?,?,?)",
              "prune-audit-" + String(index).padStart(3, "0"), "prune-fixture-extra", "test.prune",
              body.now - 100 * 86400000, "{}"
            );
          }
        });
        return jsonResponse({ ok: true, seeded: 101, auditRowsSeeded: 251 });
      }
      if (url.pathname === "/__test/prune-counts" && request.method === "GET") {
        const counts = {};
        for (const [name, sql] of Object.entries({
          tasks: "SELECT COUNT(*) AS count FROM tasks WHERE task_id LIKE 'prune-fixture-%'",
          auditEvents: "SELECT COUNT(*) AS count FROM audit_events WHERE event_id LIKE 'prune-audit-%'",
          controlAudit: "SELECT COUNT(*) AS count FROM runtime_control_audit WHERE event_id LIKE 'prune-control-%'",
          rateLimits: "SELECT COUNT(*) AS count FROM runtime_control_rate_limit WHERE actor LIKE 'prune-actor-%'",
          dailyUsage: "SELECT COUNT(*) AS count FROM daily_usage WHERE day_utc < '2099-01-01'",
          externalBudgets: "SELECT COUNT(*) AS count FROM external_request_budgets WHERE scope='ai_bank_discovery'"
        })) counts[name] = this.sql.exec(sql).one().count;
        return jsonResponse({ ok: true, counts });
      }
      if (url.pathname === "/__test/fault-suite") {
        const input = await request.json();
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 0) {
          return jsonResponse({ ok: false, error: "fault_suite_request_invalid" }, 400);
        }

        this.faultSuiteMode.active = true;
        const callStore = async (pathname, body, at) => {
          const headers = { Authorization: "Bearer " + this.env.AGENT_STATE_STORE_TOKEN };
          if (body !== undefined) headers["Content-Type"] = "application/json";
          if (at !== undefined) headers["x-test-now"] = new Date(at).toISOString();
          const response = await super.fetch(new Request("https://state-store.internal" + pathname, {
            method: body === undefined ? "GET" : "POST",
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }));
          let result;
          try { result = await response.json(); } catch { result = null; }
          return { status: response.status, body: result };
        };
        const expectStatus = (result, expected, label) => {
          if (result.status !== expected) throw new Error(label + "_unexpected_status_" + result.status);
          return result.body;
        };
        const resumeStore = async (actor, at) => {
          const observed = expectStatus(await callStore("/control", undefined, at), 200, "control_read");
          if (!observed.control.paused) return observed.control;
          const resumed = expectStatus(await callStore("/control/resume", {
            actor, requestId: crypto.randomUUID(), reason: "isolated Cloudflare fault suite", expectedVersion: observed.control.version,
          }, at), 200, "control_resume");
          if (resumed.control?.paused !== false) throw new Error("control_resume_not_persisted");
          return resumed.control;
        };
        const makeTask = () => ({
          task: {
            type: "seo.audit",
            idempotencyKey: "cloudflare-fault-suite:" + crypto.randomUUID(),
            payload: { path: "/guides" },
          },
        });
        const reserveAndClaim = async (at) => {
          const created = expectStatus(await callStore("/reserve", makeTask(), at), 201, "task_reserve");
          const taskId = created.task?.taskId;
          if (typeof taskId !== "string") throw new Error("task_reservation_missing_id");
          taskIds.push(taskId);
          const claimed = expectStatus(await callStore("/claim", { taskId }, at), 200, "task_claim");
          if (!claimed.lease || !Number.isSafeInteger(claimed.lease.generation)) throw new Error("task_lease_missing");
          return { taskId, lease: claimed.lease };
        };
        const recover = async (taskId, at, actor) => expectStatus(await callStore("/recover", {
          taskId, actor, requestId: crypto.randomUUID(),
        }, at), 200, "lease_recovery");
        const taskIds = [];
        let report;
        try {
          // 1. Emergency pause must atomically cancel a running lease and fence late writes.
          await resumeStore("fault-suite-pause", Date.now());
          const pausedWork = await reserveAndClaim(Date.now());
          const pause = expectStatus(await callStore("/control/pause", {
            actor: "fault-suite-pause", requestId: crypto.randomUUID(), reason: "fault injection: pause in flight",
          }, Date.now()), 200, "emergency_pause");
          if (pause.control?.paused !== true) throw new Error("emergency_pause_not_persisted");
          const cancelled = expectStatus(await callStore("/task?id=" + encodeURIComponent(pausedWork.taskId), undefined), 200, "paused_task_read");
          if (cancelled.task?.state !== "cancelled" || cancelled.task?.errorCode !== "operator_paused") {
            throw new Error("in_flight_task_not_cancelled");
          }
          const lateHeartbeat = await callStore("/heartbeat", {
            taskId: pausedWork.taskId, leaseOwner: pausedWork.lease.owner, leaseGeneration: pausedWork.lease.generation,
          }, Date.now());
          if (lateHeartbeat.status !== 409) throw new Error("late_heartbeat_not_fenced");
          const lateCompletion = await callStore("/complete", {
            taskId: pausedWork.taskId, leaseOwner: pausedWork.lease.owner,
            leaseGeneration: pausedWork.lease.generation, status: "succeeded",
          }, Date.now());
          if (lateCompletion.status !== 409) throw new Error("late_completion_not_fenced");

          // 2. Expiry recovery must requeue; a new generation wins over the stale owner.
          const base = Date.now() + 1000;
          await resumeStore("fault-suite-recovery", base);
          const recoveredWork = await reserveAndClaim(base);
          const expiry = base + 5 * 60 * 1000;
          const recovered = recover(recoveredWork.taskId, expiry, "fault-suite-recover-1");
          const recoveredResult = await recovered;
          if (recoveredResult.outcome !== "requeued" || recoveredResult.task?.state !== "queued") {
            throw new Error("expired_lease_not_requeued");
          }
          const retryAt = expiry + 30_000;
          const nextClaim = expectStatus(await callStore("/claim", { taskId: recoveredWork.taskId }, retryAt), 200, "retry_claim");
          if (nextClaim.lease?.generation !== recoveredWork.lease.generation + 1 ||
              nextClaim.lease?.owner === recoveredWork.lease.owner) throw new Error("lease_generation_did_not_advance");
          const staleHeartbeat = await callStore("/heartbeat", {
            taskId: recoveredWork.taskId, leaseOwner: recoveredWork.lease.owner, leaseGeneration: recoveredWork.lease.generation,
          }, retryAt + 1);
          if (staleHeartbeat.status !== 409) throw new Error("stale_generation_heartbeat_accepted");
          const staleCompletion = await callStore("/complete", {
            taskId: recoveredWork.taskId, leaseOwner: recoveredWork.lease.owner,
            leaseGeneration: recoveredWork.lease.generation, status: "succeeded",
          }, retryAt + 1);
          if (staleCompletion.status !== 409) throw new Error("stale_generation_completion_accepted");
          expectStatus(await callStore("/complete", {
            taskId: recoveredWork.taskId, leaseOwner: nextClaim.lease.owner,
            leaseGeneration: nextClaim.lease.generation, status: "succeeded",
          }, retryAt + 1), 200, "current_generation_completion");

          // 3. Provider-facing request budget must fail closed at its hard daily cap.
          const day = new Date().toISOString().slice(0, 10);
          let budget;
          for (let index = 0; index < 8; index += 1) {
            const consumed = expectStatus(await callStore("/external-budget/consume", {
              day, scope: "content_research",
            }), 200, "external_budget_consume");
            budget = consumed.budget;
            if (budget?.allowed !== true) throw new Error("external_budget_blocked_before_cap");
          }
          const exhausted = expectStatus(await callStore("/external-budget/consume", {
            day, scope: "content_research",
          }), 200, "external_budget_exhaustion");
          if (exhausted.budget?.allowed !== false || exhausted.budget?.remaining !== 0 || exhausted.budget?.used !== 8) {
            throw new Error("external_budget_did_not_fail_closed");
          }

          // 4. Five terminal lease failures in one window must open the circuit breaker.
          const breakerBase = Date.now() + 60_000;
          const failAtExpiry = breakerBase + 17 * 60 * 1000 + 30_000;
          let fifthTask;
          for (let index = 1; index <= 5; index += 1) {
            const work = await reserveAndClaim(breakerBase);
            await recover(work.taskId, breakerBase + 5 * 60 * 1000, "fault-suite-recover-" + index + "-a");
            const second = expectStatus(await callStore("/claim", { taskId: work.taskId }, breakerBase + 5 * 60 * 1000 + 30_000), 200, "breaker_second_claim");
            await recover(work.taskId, breakerBase + 10 * 60 * 1000 + 30_000, "fault-suite-recover-" + index + "-b");
            const third = expectStatus(await callStore("/claim", { taskId: work.taskId }, breakerBase + 12 * 60 * 1000 + 30_000), 200, "breaker_third_claim");
            if (index < 5) {
              const failed = await recover(work.taskId, failAtExpiry, "fault-suite-recover-" + index + "-c");
              if (failed.outcome !== "failed" || failed.task?.state !== "failed") throw new Error("breaker_fixture_failure_not_terminal");
            } else {
              fifthTask = { taskId: work.taskId, lease: third.lease };
            }
          }
          // A live sentinel lease must be cancelled when the fifth failure opens the breaker.
          const sentinel = await reserveAndClaim(breakerBase + 12 * 60 * 1000 + 30_000);
          const fifthFailure = await recover(fifthTask.taskId, failAtExpiry, "fault-suite-recover-5-c");
          if (fifthFailure.outcome !== "failed") throw new Error("fifth_failure_not_terminal");
          const breakerControl = expectStatus(await callStore("/control"), 200, "breaker_control_read");
          if (breakerControl.control?.paused !== true || breakerControl.control?.failureCountLast10m !== 5) {
            throw new Error("circuit_breaker_did_not_open");
          }
          const sentinelTask = expectStatus(await callStore("/task?id=" + encodeURIComponent(sentinel.taskId)), 200, "sentinel_read");
          if (sentinelTask.task?.state !== "cancelled" || sentinelTask.task?.errorCode !== "circuit_breaker_paused") {
            throw new Error("circuit_breaker_did_not_cancel_running_lease");
          }
          const sentinelLateWrite = await callStore("/heartbeat", {
            taskId: sentinel.taskId, leaseOwner: sentinel.lease.owner, leaseGeneration: sentinel.lease.generation,
          }, failAtExpiry + 1);
          if (sentinelLateWrite.status !== 409) throw new Error("circuit_breaker_stale_lease_not_fenced");

          // 5. A forced SQLite transaction exception must leave no committed row.
          const rollbackAt = await super.fetch(new Request("https://state-store.internal/__test/rollback", {
            method: "POST",
            headers: { Authorization: "Bearer " + this.env.AGENT_STATE_STORE_TOKEN },
          }));
          const rollback = await rollbackAt.json();
          if (rollback?.ok !== true || rollback?.rolledBack !== true || rollback?.acceptedToday !== 0) {
            throw new Error("sqlite_transaction_rollback_probe_failed_" + JSON.stringify(rollback));
          }

          // 6. Recovery alarms stay disabled in this harness.
          const alarmResponse = await super.fetch(new Request("https://state-store.internal/__test/alarm-state", {
            headers: { Authorization: "Bearer " + this.env.AGENT_STATE_STORE_TOKEN },
          }));
          const alarm = await alarmResponse.json();
          if (alarm?.ok !== true || alarm.alarmAt !== null) throw new Error("unexpected_recovery_alarm_scheduled");

          report = {
            ok: true,
            pauseInFlightCancelled: true,
            staleOwnerAndGenerationRejected: true,
            leaseExpiryRequeued: true,
            currentGenerationCompleted: true,
            externalRequestBudgetLimit: 8,
            externalRequestBudgetExhausted: true,
            circuitBreakerOpenedAtFailures: 5,
            circuitBreakerCancelledRunningLease: true,
            sqliteTransactionRollback: true,
            recoveryAlarmDisabled: true,
            isolatedNamespace: true,
            taskCount: taskIds.length,
          };
        } finally {
          // Fail closed even if an assertion above throws; the isolated store must end paused.
          try {
            const control = await callStore("/control");
            if (control.status === 200 && control.body?.control?.paused === false) {
              await callStore("/control/pause", {
                actor: "fault-suite-cleanup", requestId: crypto.randomUUID(), reason: "fault suite cleanup",
              });
            }
          } catch {}
          try {
            const ids = this.sql.exec(
              "SELECT task_id FROM tasks WHERE idempotency_key LIKE 'cloudflare-fault-suite:%'"
            ).toArray();
            for (const row of ids) this.sql.exec("DELETE FROM audit_events WHERE task_id = ?", row.task_id);
            this.sql.exec("DELETE FROM tasks WHERE idempotency_key LIKE 'cloudflare-fault-suite:%'");
            this.sql.exec("DELETE FROM daily_usage WHERE day_utc = ?", new Date().toISOString().slice(0, 10));
            this.sql.exec("DELETE FROM external_request_budgets WHERE budget_day = ? AND scope = 'content_research'", new Date().toISOString().slice(0, 10));
            this.sql.exec("DELETE FROM runtime_control_rate_limit WHERE actor LIKE 'fault-suite-%'");
            this.sql.exec("DELETE FROM runtime_control_audit WHERE actor LIKE 'fault-suite-%'");
          } catch {}
          this.faultSuiteMode.active = false;
        }
        return jsonResponse(report ?? { ok: false, error: "fault_suite_failed" }, report?.ok ? 200 : 500);
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

      // Repeated Preview runs reuse the isolated Durable Object namespace.
      // Clear this test-only sentinel first so a prior failed run cannot poison the next rollback assertion.
      this.sql.exec("DELETE FROM daily_usage WHERE day_utc = '2099-12-31'");
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("INSERT INTO daily_usage (day_utc, accepted_count) VALUES ('2099-12-31', 1)");
        throw new Error("intentional_rollback_probe");
      });
    } catch (error) {
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
      const diagnostic = String(error?.message ?? error ?? "unknown")
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
        .slice(0, 180);
      return jsonResponse({ ok: false, error: "test_fixture_operation_failed", diagnostic }, 500);
    }
    return jsonResponse({ ok: false, error: "rollback_probe_did_not_throw" }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/__test/fault-suite" || request.method !== "POST") {
      return new Response("not_found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (!await hasValidStateStoreBearer(request, { ...env, AGENT_STATE_STORE_TOKEN: env.AGENT_FAULT_TEST_TOKEN ?? env.AGENT_STATE_STORE_TOKEN })) {
      return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
    }
    if (!env.AGENT_STATE_STORE || typeof env.AGENT_STATE_STORE.idFromName !== "function" ||
        typeof env.AGENT_STATE_STORE.get !== "function") {
      return jsonResponse({ ok: false, error: "state_store_binding_unavailable" }, 503);
    }
    const stub = env.AGENT_STATE_STORE.get(env.AGENT_STATE_STORE.idFromName("agent-runtime-global"));
    const body = await request.arrayBuffer();
    if (body.byteLength > 1024) return jsonResponse({ ok: false, error: "request_body_too_large" }, 413);
    return stub.fetch(new Request("https://state-store.internal/__test/fault-suite", {
      method: "POST",
      headers: request.headers,
      body,
    }));
  },
  };

