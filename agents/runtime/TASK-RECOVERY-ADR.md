# Agent Runtime — task lease and recovery architecture decision

Status: **schema v2 migration and transactional claim/heartbeat/completion/expiry-recovery routes are implemented in Draft PR #297, with pure policy helpers and tests. They remain unmerged and unbound. No Durable Object binding, alarm, schedule, or task execution is enabled.**

Date: 2026-11-19

## Decision

Use a durable lease with a monotonically increasing fencing generation for future task claiming. The SQLite Durable Object remains the single serialization authority. A worker may act only while it owns the current unexpired lease generation.

The initial task types (`content.review`, `ai_bank.candidate_review`, and `seo.audit`) are intended to be read-only review/audit operations. Before any task type can create external side effects (publishing, editing live content, sending messages, changing account settings, or writing production data), it must have a separate side-effect idempotency contract and explicit destination allowlist.

## Proposed schema migration

A future schema version should add bounded fields to `tasks`:

- `attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)`
- `max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5)`
- `lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0)`
- `lease_owner TEXT` — opaque per-claim identifier; never a credential
- `lease_expires_at INTEGER`
- `next_attempt_at INTEGER`
- `last_error_code TEXT` — bounded machine-readable code only

Add indexes for `(state, next_attempt_at)` and `(state, lease_expires_at)`. Migration must be transactional, versioned, and tested against both an empty database and a persisted v1 database. Do not mutate the current schema until the migration and recovery tests are implemented.

## Implementation progress (2026-11-19)

- Draft PR #296 adds pure policy functions for claim, heartbeat, expiry recovery, and fenced completion.
- Draft PR #297 adds a transactional schema v1 -> v2 migration. Fresh stores intentionally create the v1 baseline and run the same migration path used for persisted v1 data.
- Schema v2 adds bounded attempt counters, monotonically increasing lease generation, opaque owner, per-claim expiry, absolute lease maximum expiry (30 minutes), retry due time, and bounded machine-readable last-error code. The migration adds retry/lease indexes and preserves existing task and usage rows.
- The State Store exposes authenticated `/claim`, `/heartbeat`, `/complete`, and operator-invoked `/recover` routes. Claim and recovery fail closed while paused; heartbeat and completion may finish an already-owned lease while paused.
- SQL updates are performed in synchronous SQLite transactions with task state, owner, generation, and expiry predicates. A stale generation cannot heartbeat or complete a newer attempt.
- Every claim, heartbeat, retry/requeue, expiry failure, and terminal completion appends an audit event in the same transaction. Same-generation repeated terminal completion is idempotent and does not write another event.
- Generic `/transition` can no longer start or finish running work; a valid lease is required.
- The State Store validates a dedicated `AGENT_STATE_STORE_TOKEN`, distinct from the external `AGENT_OPERATOR_TOKEN`. The Worker-to-DO call path and binding remain intentionally unwired.
- Migration tests cover a fresh store and a persisted v1-shaped store with task and daily-usage preservation. Lease tests cover concurrent claim, fencing, heartbeat, pause behavior, bounded recovery, and attempt exhaustion.
- The test-only v1 fixture route is guarded by `RUNTIME_TESTING=true`; the deploy configuration does not set that flag.

The next implementation step is independent security review and Worker-to-State-Store call-path integration in an isolated, separate Preview config. Do not enable a Durable Object binding, scheduler, or task execution as part of this PR.

## State machine

- `queued -> running`: only an atomic claim may perform this transition. It increments attempt_count and lease_generation, creates a fresh opaque lease_owner, and sets lease_expires_at.
- `running -> running`: heartbeat may extend the lease only when task ID, lease_owner, and lease_generation match and the existing lease has not expired.
- `running -> succeeded|failed|cancelled`: completion is accepted only from the current lease owner and generation. A stale worker must receive a conflict and cannot overwrite a newer attempt.
- Expired `running` task with attempts remaining: after expiry plus bounded retry delay, recovery may return it to `queued`, clear lease fields, set next_attempt_at, and append an audit event.
- Expired `running` task at max attempts: move it to `failed` with a stable code such as `lease_expired_max_attempts`, clear lease fields, and append an audit event.
- A terminal task never reopens. A repeated terminal completion with the same terminal state is idempotent; conflicting terminal transitions fail.

Every claim, heartbeat, retry/requeue, expiry failure, cancellation, and terminal completion must update task state and append its audit event in the same SQLite transaction.

## Retry policy

- Maximum attempts: 3 by default; hard maximum 5.
- Lease duration: start with 5 minutes for bounded review tasks; heartbeat may extend only within a documented maximum task lifetime.
- Backoff: bounded exponential delay (for example 30 seconds, 2 minutes, then 5 minutes); clamp all values and test with injected time.
- Do not retry authentication failures, invalid task contracts, unsupported schema, or deterministic policy rejections.
- Retry transient store/network failures only when the operation is known to be safe to repeat.
- Exhausted tasks become terminal and visible for operator review; never retry indefinitely.

These are proposed retry/lease defaults, not live configuration. The current state-store admission defaults are separately capped at 100 reservations/day and 5 in-flight tasks for the Free-tier pilot; hard code ceilings remain 1,000/day and 100 in-flight.

## At-least-once semantics and side effects

A lease cannot guarantee exactly-once execution. A worker can perform an external action and crash before recording success. Therefore:

1. The execution contract must be at-least-once and state that explicitly.
2. Read-only audit/review tasks may be retried within the bounded policy.
3. Any future write/publish/send task must pass a stable idempotency key to the destination or use a transactional outbox/reconciliation mechanism.
4. If the destination cannot deduplicate or reconcile an uncertain outcome, automatic retry is prohibited; send the task to manual review instead.
5. Never infer success from a timeout, lost connection, or worker crash.

## Pause and kill-switch behavior

- When disabled or paused, reject new reservations and new claims.
- A pause prevents new dispatch; it does not pretend an already-issued external request can be recalled.
- Heartbeats and safe completion recording may continue for a currently owned lease so an in-flight read-only operation can close cleanly. If the operation cannot safely finish, mark it for operator review rather than blindly replaying it.
- Recovery scans must not requeue tasks while paused.
- Resume requires both explicit flags (`AGENT_ENABLED=true`, `AGENT_PAUSED=false`) and valid operator authentication.
- A hard stop may cancel local work, but cannot guarantee cancellation of a remote provider request already accepted.

## Security and audit requirements

- Every State Store route remains operator-authenticated; internal Worker-to-DO calls must use a secret injected only at deployment, never stored in task rows or logs.
- Lease owner is an opaque identifier, not an authentication credential.
- Compare generation and owner on every heartbeat and completion to prevent stale workers from writing after lease expiry.
- Test-only clock override and rollback route remain unavailable in deployment config.
- Audit metadata contains only task ID, event type, bounded error code, attempt number, generation, and timestamps; no bearer token, article body, personal data, or provider secret.
- Rate-limit operator inspection endpoints before any public exposure.

## Required tests before implementation can be accepted

1. v1-to-v2 migration preserves existing tasks, idempotency keys, usage counters, and audit rows.
2. Concurrent claims of one queued task yield exactly one current lease.
3. A stale generation cannot heartbeat, complete, or cancel a newer attempt.
4. Expired lease is not recovered before expiry and is recoverable after expiry.
5. Retry delay and attempt ceiling are enforced atomically.
6. Exhausted lease transitions to terminal failure exactly once.
7. Paused/disabled Runtime does not claim or requeue work.
8. Duplicate idempotency key never creates a second task.
9. A crash/restart preserves lease and retry metadata.
10. All state transitions and audit writes roll back together on injected failure.
11. No execution, schedule, alarm, binding, or external side effect is introduced by the recovery layer.

## Release gate

Do not add recovery code to the live Preview config, bind a Durable Object, deploy, enable alarms/schedules, or connect execution until:
- this design is independently reviewed;
- migration and concurrency tests pass in local Miniflare/workerd;
- stale-worker fencing and pause behavior are proven;
- task-specific side-effect idempotency is documented;
- Free-tier usage is measured and within the no-cost budget;
- a manual rollback and kill-switch procedure is verified.

No Production Worker, DNS, D1, live data, billing, secret, or social account is changed by this design.
