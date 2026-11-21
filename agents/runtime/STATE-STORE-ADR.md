# Agent Runtime state store — architecture decision

Status: **SQLite Durable Object implementation, schema v1-v7 migrations, operator control/recovery bridge, bounded result persistence, and an opt-in scheduled queue dispatcher are in Draft PR #339. The dedicated Preview config defines one SQLite Durable Object binding but contains no `triggers` entry. `AGENT_SCHEDULER_ENABLED=false`, `AGENT_RECOVERY_ALARM_ENABLED=false`, `AGENT_ENABLED=false`, and `AGENT_PAUSED=true`; no dedicated Runtime deployment or required secrets are verified. This is code-level scheduler support only, not a running or 24/7 service.**

Date: 2026-11-20

## Decision

Use one isolated, SQLite-backed Cloudflare Durable Object as the coordination authority for the Preview Agent Runtime, provided the account remains on the Workers Free plan and the design is validated locally before any deployment.

The first iteration uses one stable logical object (for example, \`agent-runtime-global\`) so task admissions, idempotency reservations, daily counters, and in-flight counts are serialized through one strongly consistent authority. This is intentionally a low-volume single-queue design, not a horizontal high-throughput architecture. A single global object is a throughput bottleneck by design; shard only if measured workload later requires it and a safe global-quota design is established.

Do not use Workers KV for admission counters: its eventual-consistency behavior is unsuitable as the sole authority for atomic quota reservations. Do not use process memory or per-Worker instance maps for durable state.

## Why SQLite-backed Durable Objects

Cloudflare's current Durable Objects pricing documentation (last updated 2026-11-13) states that SQLite-backed Durable Objects are available on Workers Free. Published Free allowances include 100,000 Durable Object requests/day (alarm invocations count as requests), 13,000 GB-s/day, 5 million SQL rows read/day, 100,000 SQL rows written/day, and 5 GB of SQL storage. Each SQLite-backed `setAlarm()` is one SQL row write; deletes also count as row writes. Daily limits reset at 00:00 UTC and exceeding a Free limit causes further operations of that type to fail. These are platform ceilings, not evidence that this Cloudflare account is on Free or has remaining headroom. No paid upgrade or overage is authorized.

Official references:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

## Transaction boundary

A single admission operation performs the following in one synchronous SQLite transaction:

1. Validate the allowlisted task contract before persistence.
2. Look up the idempotency key. If already reserved with the same type and payload hash, return the existing task without incrementing counters; a different payload returns a conflict.
3. Read the current UTC day bucket and daily accepted count.
4. Derive the current in-flight count from durable task rows in \`queued\` or \`running\`.
5. Check the daily, concurrency, and serialized-payload limits.
6. Insert the task reservation, increment the daily accepted count, and append a non-sensitive audit event.
7. Commit all changes together; an exception rolls back all writes.

Use Durable Object SQLite \`transactionSync(callback)\`; do not issue SQL \`BEGIN\` or \`SAVEPOINT\` statements through \`sql.exec()\`. The callback must remain synchronous. SQL parameters are bound; caller strings are never interpolated into SQL.

## Implemented schema

- `runtime_meta`: schema version.
- `daily_usage`: UTC day primary key and accepted count.
- `tasks`: opaque task ID, unique idempotency key, allowlisted type, validated minimal payload JSON, payload hash/size, state, timestamps, bounded attempt count, maximum attempts, lease generation/owner/expiry/absolute expiry, next retry time, bounded error codes, and an optional strict-schema review result JSON field capped at 4 KiB.
- `audit_events`: event ID, task ID, event type, timestamp, and non-sensitive metadata only.
- `runtime_control` and `runtime_control_audit`: durable fail-closed pause state and operator action audit.
- `runtime_control_rate_limit`: persistent per-actor control mutation window and request count.
- `oidc_jti_replay`: SHA-256 hashes of consumed GitHub OIDC `jti` values, retained until 24 hours after JWT expiry, with atomic single-use enforcement.
- `external_request_budgets`: per-UTC-day, per-scope outbound request counters with atomic caps.
- `tasks.result_json`: bounded (4 KiB) structured result persistence for read-only task handlers.

Schema migrations v1-to-v7 are transactional and preserve existing task and daily-usage rows. The two prior branches independently used v6 for external-request budgets and bounded task results; v7 idempotently ensures the budget table/index and adds `tasks.result_json` only when absent, so either persisted v6 shape upgrades safely.

## State transitions

- `queued -> running` occurs only through an atomic claim while `AGENT_ENABLED=true` and `AGENT_PAUSED=false`; generic `/transition` cannot bypass lease ownership. `queued -> cancelled` remains available while paused for operator cleanup.
- Claim increments the attempt count and lease generation and assigns an opaque lease owner. Heartbeat and completion require the current owner/generation and an unexpired lease; stale owners are rejected by fencing checks.
- A lease has a five-minute initial duration, a 15-minute maximum individual extension, and a 30-minute absolute lifetime. Heartbeat and completion may finish an already-owned in-flight task while admission is paused; new claims and recovery are blocked while paused.
- Expired-lease recovery is bounded: it requeues before the attempt ceiling with a bounded retry delay, or marks the task failed at the ceiling. An operator-invoked `POST /recover` remains available; a separate recovery-only Durable Object alarm can perform the same bounded lease recovery when explicitly enabled. The alarm is disabled in Preview config and does not dispatch queued tasks.
- Repeating the same terminal completion for the same lease generation is idempotent; attempting to reopen or change a terminal state is rejected.
- In-flight count is derived from durable task rows; terminal transitions do not decrement a separate counter.

The Worker implements an opt-in `scheduled()` handler for one bounded queue-dispatch tick. It accepts only the exact 30-minute cron expression, requires `AGENT_SCHEDULER_ENABLED=true`, `AGENT_RECOVERY_ALARM_ENABLED=true`, `AGENT_ENABLED=true`, `AGENT_PAUSED=false`, and a valid operator bearer, then reuses the authenticated dispatcher with a hard-coded batch size of one. The dedicated Preview config has no `triggers` entry, so no Cron schedule is configured; the handler remains dormant. No task is admitted by the scheduler, no retry loop is started, and no publishing or external write handler is available.

## Retention and budgets

- Enforced code ceilings and defaults: 100 task reservations/day, 5 in-flight tasks, and 8 KiB per serialized task request. These are internal guardrails, not measured account quota.
- Terminal task rows are retained for 30 days; audit and daily-usage rows are retained for 90 days. Idempotency protection is bounded by the 30-day task retention.
- Admission, claim, heartbeat, recovery and terminal completion update task rows and append audit events in the same SQLite transaction. Heartbeats add two row writes apiece; actual heartbeat cadence and recovery rates must be measured before any live Preview binding.
- These internal limits are conservative guardrails, not evidence of remaining account quota or guaranteed availability.
- Hypothetical scheduler budget model (code-only, not configured or measured): if a `*/30 * * * *` trigger were later added, it would produce 48 Worker Cron invocations/day. Each tick is hard-bounded to one task; a non-empty tick can issue one `/claim-next`, one `/complete`, and up to seven `/heartbeat` Durable Object requests if the review runs for the full 15-minute Cron wall-time window. This is not current usage: the Preview config has no Cron trigger and the scheduler flag is false. Cloudflare plan/remaining quota and actual CPU/SQL usage must be independently verified before any trigger is added.
- The Worker also exposes operator-authenticated `POST /internal/enqueue` for bounded, idempotent admission of one to five validated tasks; it only reserves queue entries and does not execute them. `POST /internal/dispatch` is a separate bounded operator action.
- The State Store exposes authenticated `/claim-next`, which atomically selects the oldest due queued task and grants a fenced lease. Operator `POST /internal/dispatch` retains a hard maximum batch of five. The scheduled handler reuses this same path but hard-caps itself at one task per 30-minute tick. All review handlers remain read-only; no publishing/write handlers are wired.
- A bounded lease-recovery alarm handler is now implemented in the isolated source branch. It is gated by `AGENT_RECOVERY_ALARM_ENABLED=true`, the existing outer enabled/unpaused flags, and the durable pause control. The checked-in Preview value is `false`. The handler uses one shared alarm with a five-minute minimum cadence, processes at most five expired leases per invocation, audits each recovery, and clears itself while disabled or paused. It only requeues/fails expired leases; it does not claim or execute queued tasks. This is not a scheduler or 24/7 execution path. It has not been deployed or enabled.

## Failure behavior

- Missing binding, SQL error, transaction failure, unsupported schema version, invalid limit configuration, or exhausted storage: reject; never fall back to memory.
- Duplicate idempotency key: return the original reservation; do not create a second task.
- Daily limit reached, concurrency full, or payload too large: reject with a stable machine-readable reason.
- Store failure must never be represented as successful acceptance.
- Keep \`AGENT_ENABLED=false\` and \`AGENT_PAUSED=true\` until all independent gates pass.

## OIDC replay ledger — internal primitive only

Schema v5 adds `POST /oidc/replay/consume` inside the State Store. It is protected by the distinct Worker-to-State-Store bearer and is consumed by the manual, pause-only OIDC route after exact GitHub Actions token verification. The request accepts only a bounded `jti` and decimal Unix-seconds `expiresAt`; unknown fields, malformed identifiers, expired tokens, and excessive expiries are rejected. The store hashes `jti` with SHA-256, checks and inserts the digest in one synchronous SQLite transaction, and returns conflict for duplicate consumption.

The manual `POST /internal/oidc/pause` route verifies GitHub Actions OIDC claims against the fixed issuer/JWKS and exact Preview trust policy, then consumes the replay ledger before pausing. It is gated off by `AGENT_OIDC_ENABLED=false`, is pause-only, and does not authorize Resume or establish a human session. It must not be described as a general-purpose OIDC admin login or a second factor.

## Operational control-plane gaps

- The State Store `POST /recover` route remains behind the dedicated Worker-to-DO internal bearer. The Worker source contains an operator-authenticated `POST /internal/recover` bridge that injects a configured service actor and server-generated request ID, forwards only the dedicated internal credential, and returns a minimized task projection. The State Store validates the actor/request ID, applies a durable per-actor 10-per-60-second rate limit, and records the recovery audit event. This is source-level functionality only; it is not operational until the dedicated Preview Worker is deployed with Preview-only binding and secrets.
- The current pause controls include independent environment gates (`AGENT_ENABLED` and `AGENT_PAUSED`), bearer-authenticated pause/resume control routes, and a manual GitHub OIDC pause-only path. The OIDC workflow does not provide resume or prove a human browser session. None is a substitute for an independently tested emergency procedure that can stop the Worker or revoke credentials if the control plane itself is unavailable. Do not claim an instant, end-to-end emergency kill switch.
- There is no browser-facing operator UI, session-based admin access, MFA, or per-human identity. The recovery bridge uses a configured service actor and shared operator bearer; its audit identity is a service identity, not proof of which human initiated the action. Do not expose the operator or internal State Store token to browser clients.
- The OIDC pause path is wired in source and consumes a durable replay-ledger entry before pausing. It is manual, pause-only, gated off by default, and not operational until independently reviewed Preview configuration and credentials exist. Do not describe it as a general-purpose OIDC admin session or as enabling task execution.
- Before enabling read-only task processing or any scheduled recovery/dispatch, independently review shared rate-limit semantics, service-actor audit limitations, cancellation, recovery and pause behavior, credential revocation, monitoring, and rollback. Keep all runtime gates closed until these gates pass; do not add external-effect handlers.
## Not approved by this ADR

- No Durable Object namespace/binding or migration is added to the validation-only `wrangler.jsonc`. A separate `wrangler.preview.jsonc` now declares one SQLite `AgentStateStore` binding and its initial migration, with both runtime gates closed. This Preview config is code-only and has not been deployed; secrets, account identifiers, production routes, and schedules remain absent.
- No Cloudflare Agent Runtime deployment, secret configuration, active recovery alarm, Cron Trigger, queue consumer, or public endpoint is enabled. Worker source recognizes an exact Cron expression, but the dedicated Preview config has no `triggers` entry and the scheduler handler remains gated off.
- Only bounded, allowlisted read-only handlers exist in source. The scheduled dispatcher and recovery alarm are dormant; no publishing or other external write side effect, automatic background execution, backup/restore promise, or 24/7 claim is authorized.
- No Production Worker, DNS, D1, or live data is changed.

## Implementation gates

1. Complete independent source/security review and retain passing Miniflare/workerd evidence for schema migration, rollback, distinct operator/internal auth, concurrent claims, fencing, pause, heartbeat, retry bounds, and restart persistence.
2. Review Free-plan request and SQL-row budgets against actual expected workload, including heartbeat audit writes.
3. Independently review the existing Worker-to-State-Store call path through the fixed DO identity and dedicated internal token in the separate Runtime Preview config; do not change the standard unbound `wrangler.jsonc` or Production configuration.
4. Deploy only after Preview-only permissions and Free-plan headroom are verified; keep the runtime disabled and paused.
5. Add task handlers only after independent review of read-only scope, side-effect idempotency, kill switch, monitoring, and rollback.
