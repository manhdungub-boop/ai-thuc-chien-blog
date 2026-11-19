# Agent Runtime state store — architecture decision

Status: **SQLite Durable Object implementation with schema v5 migrations, transactional lease operations, and an internal OIDC replay-ledger primitive is in Draft PR #297; local Miniflare/workerd validation is running for the latest revision; not bound, not deployed, and not connected to task execution**.

Date: 2026-11-19

## Decision

Use one isolated, SQLite-backed Cloudflare Durable Object as the coordination authority for the Preview Agent Runtime, provided the account remains on the Workers Free plan and the design is validated locally before any deployment.

The first iteration uses one stable logical object (for example, \`agent-runtime-global\`) so task admissions, idempotency reservations, daily counters, and in-flight counts are serialized through one strongly consistent authority. This is intentionally a low-volume single-queue design, not a horizontal high-throughput architecture. A single global object is a throughput bottleneck by design; shard only if measured workload later requires it and a safe global-quota design is established.

Do not use Workers KV for admission counters: its eventual-consistency behavior is unsuitable as the sole authority for atomic quota reservations. Do not use process memory or per-Worker instance maps for durable state.

## Why SQLite-backed Durable Objects

Cloudflare documents SQLite-backed Durable Objects as available on Workers Free. Published Free allowances include 100,000 Durable Object requests/day, 13,000 GB-s/day, 100,000 SQL rows written/day, and 5 GB of account storage. These are platform ceilings, not account-specific remaining quota. Exceeding a Free allowance causes operations of that type to fail; no paid upgrade is authorized.

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
- `tasks`: opaque task ID, unique idempotency key, allowlisted type, validated minimal payload JSON, payload hash/size, state, timestamps, bounded attempt count, maximum attempts, lease generation/owner/expiry/absolute expiry, next retry time, and bounded error codes.
- `audit_events`: event ID, task ID, event type, timestamp, and non-sensitive metadata only.
- `runtime_control` and `runtime_control_audit`: durable fail-closed pause state and operator action audit.
- `runtime_control_rate_limit`: persistent per-actor control mutation window and request count.
- `oidc_jti_replay`: SHA-256 hashes of consumed GitHub OIDC `jti` values, retained until 24 hours after JWT expiry, with atomic single-use enforcement.

Schema migrations v1-to-v5 are transactional and preserve existing task and daily-usage rows. Constraints include a unique idempotency key, CHECK constraints for task state/type and bounded lease fields, bounded payload size, and bounded audit metadata. No credentials, bearer tokens, article body contents, or personal data are stored in audit rows.

## State transitions

- `queued -> running` occurs only through an atomic claim while `AGENT_ENABLED=true` and `AGENT_PAUSED=false`; generic `/transition` cannot bypass lease ownership. `queued -> cancelled` remains available while paused for operator cleanup.
- Claim increments the attempt count and lease generation and assigns an opaque lease owner. Heartbeat and completion require the current owner/generation and an unexpired lease; stale owners are rejected by fencing checks.
- A lease has a five-minute initial duration, a 15-minute maximum individual extension, and a 30-minute absolute lifetime. Heartbeat and completion may finish an already-owned in-flight task while admission is paused; new claims and recovery are blocked while paused.
- Expired-lease recovery is bounded: it requeues before the attempt ceiling with a bounded retry delay, or marks the task failed at the ceiling. Recovery is an operator-invoked `POST /recover`; it is **not automatic**.
- Repeating the same terminal completion for the same lease generation is idempotent; attempting to reopen or change a terminal state is rejected.
- In-flight count is derived from durable task rows; terminal transitions do not decrement a separate counter.

The implementation does not include an alarm, cron trigger, queue consumer, automatic recovery scheduler, task handler, or external-side-effect idempotency. An expired task can remain running until an authorized operator invokes recovery.

## Retention and budgets

- Enforced code ceilings and defaults: 100 task reservations/day, 5 in-flight tasks, and 8 KiB per serialized task request. These are internal guardrails, not measured account quota.
- Terminal task rows are retained for 30 days; audit and daily-usage rows are retained for 90 days. Idempotency protection is bounded by the 30-day task retention.
- Admission, claim, heartbeat, recovery and terminal completion update task rows and append audit events in the same SQLite transaction. Heartbeats add two row writes apiece; actual heartbeat cadence and recovery rates must be measured before any live Preview binding.
- These internal limits are conservative guardrails, not evidence of remaining account quota or guaranteed availability.

## Failure behavior

- Missing binding, SQL error, transaction failure, unsupported schema version, invalid limit configuration, or exhausted storage: reject; never fall back to memory.
- Duplicate idempotency key: return the original reservation; do not create a second task.
- Daily limit reached, concurrency full, or payload too large: reject with a stable machine-readable reason.
- Store failure must never be represented as successful acceptance.
- Keep \`AGENT_ENABLED=false\` and \`AGENT_PAUSED=true\` until all independent gates pass.

## OIDC replay ledger — internal primitive only

Schema v5 adds `POST /oidc/replay/consume` inside the State Store. It is protected by the existing distinct Worker-to-State-Store bearer and is not bridged through the Worker. The request accepts only a bounded `jti` and decimal Unix-seconds `expiresAt`; unknown fields, malformed identifiers, expired tokens, and expiries more than 11 minutes ahead are rejected. The store hashes `jti` with SHA-256, checks and inserts the digest in one synchronous SQLite transaction, and returns conflict for duplicate consumption. Expired ledger rows are deleted in batches of at most 100 per call; a consumed digest is retained until 24 hours after JWT expiry.

This primitive does not verify JWT signatures, fetch JWKS, validate claims, or authorize Pause/Resume. A future OIDC caller must verify the token first, then consume `jti`, and only then perform a state-changing action. Both operations must fail closed. If the store is unavailable, the action must not proceed.

## Operational control-plane gaps

- The State Store `POST /recover` route exists only behind the dedicated Worker-to-DO internal bearer. The current Worker shell exposes no operator-authenticated recovery bridge. Therefore recovery is implemented in the DO class but is **not yet operationally callable by an operator through the deployed Worker surface**.
- The current pause controls are environment flags (`AGENT_ENABLED` and `AGENT_PAUSED`), not a separately authenticated, dynamically mutable kill-switch API. A change to runtime flags requires a controlled configuration/deployment operation; do not describe this as an instant remote kill switch.
- There is no operator UI, session-based admin access, rate-limited control plane, or operator-action audit identity. Do not expose the internal State Store token to a browser or add a public recovery route using the operator bearer until an independently reviewed control-plane design is approved.
- Before any task execution, implement and test a minimal operator control plane with server-side authentication, narrow allowlisted actions, rate limiting, explicit pause/resume semantics, operator identity in audit events, and a tested rollback path. Until then, keep the Runtime disabled and unbound.
## Not approved by this ADR

- No Durable Object namespace/binding or migration is added to the checked-in Preview Worker config.
- No Cloudflare Agent Runtime deployment, secret configuration, alarm, cron trigger, queue consumer, or public endpoint is enabled.
- No task execution, external side effects, backup/restore promise, or 24/7 claim is authorized.
- No Production Worker, DNS, D1, or live data is changed.

## Implementation gates

1. Complete independent source/security review and retain passing Miniflare/workerd evidence for schema migration, rollback, distinct operator/internal auth, concurrent claims, fencing, pause, heartbeat, retry bounds, and restart persistence.
2. Review Free-plan request and SQL-row budgets against actual expected workload, including heartbeat audit writes.
3. Integrate the Worker-to-State-Store call path through the fixed DO identity and dedicated internal token in a separate Runtime Preview config; do not change this unbound shell config.
4. Deploy only after Preview-only permissions and Free-plan headroom are verified; keep the runtime disabled and paused.
5. Add task handlers only after independent review of read-only scope, side-effect idempotency, kill switch, monitoring, and rollback.
