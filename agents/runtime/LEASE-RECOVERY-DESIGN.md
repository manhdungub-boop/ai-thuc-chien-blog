# Agent Runtime lease, fencing, and emergency-stop design

Status: **design only; not implemented, not deployed, and not an authorization to enable execution**.

Date: 2026-11-20  
Scope: isolated Agent Runtime Preview branch. Production Worker, DNS, D1, secrets, and public publishing remain out of scope.

## Goals

Define a recoverable single-queue execution protocol before adding a scheduler or outbound side effects. The protocol must prevent stale workers from changing task state, prevent duplicate external effects where the destination supports idempotency, and make pause/stop behavior fail closed.

## Non-goals

- This document does not add a Durable Object binding, alarm, cron, queue consumer, secret, or deploy workflow.
- It does not promise exactly-once delivery to an external system.
- It cannot retract a network request already accepted by a remote service.
- It does not authorize production publishing or Facebook access.

## Proposed durable task fields

Add fields only in a versioned SQLite migration after independent review:

- `attempt`: non-negative integer, incremented on each successful claim.
- `lease_owner`: bounded opaque executor instance identifier; never a user-supplied URL or credential.
- `lease_expires_at`: UTC epoch milliseconds; null when no active lease exists.
- `fencing_token`: monotonically increasing integer per task, incremented on every claim/reclaim.
- `cancel_requested_at`: timestamp set when the operator requests cancellation.
- `last_heartbeat_at`: timestamp updated only by the current lease holder.

The store remains the sole authority. Executor memory is disposable and never determines ownership.

## Claim and recovery protocol

1. Claim runs inside one synchronous SQLite transaction.
2. Claim is permitted only when both `AGENT_ENABLED=true` and `AGENT_PAUSED=false`, and the persistent emergency-stop control is clear.
3. Select one eligible queued task, or one running task whose lease has expired. Never claim terminal tasks.
4. Increment `attempt` and `fencing_token`; assign a fresh random `lease_owner`; set a bounded expiry; append a minimal audit event.
5. Return only task ID, allowlisted task type/payload, lease owner, fencing token, and expiry.
6. Heartbeat, completion, failure, and cancellation must compare task ID + lease owner + fencing token + unexpired lease in the same transaction. A mismatch is a stale-worker conflict and must not mutate state.
7. Expired leases may be reclaimed only by the claim transaction. A late worker cannot revive its old lease.
8. Enforce a small maximum attempt count. Exhausted tasks become terminal failed with a stable error code and audit event; no unbounded retry loop.

Lease duration, heartbeat cadence, attempt cap, and retry backoff must be selected from measured execution bounds, not guessed in production.

## Emergency stop semantics

Use two independent layers:

- **Configuration gate:** `AGENT_ENABLED=false` or `AGENT_PAUSED=true` blocks admission and new claims.
- **Persistent operator stop:** an authenticated, audited State Store control records a monotonic stop epoch and stop state. The stop operation must be idempotent and must commit before returning success.

Every claim, heartbeat, state transition, and outbound-effect authorization checks the current stop state/epoch. A worker must re-check immediately before each external side effect. On stop, the runtime stops claiming, stops scheduling, marks queued work cancelled where safe, and signals active workers to abort cancellable work.

Important limitation: a stop cannot undo an HTTP request already transmitted or a side effect already accepted by a remote service. The UI/status response must distinguish “dispatch stopped” from “all external effects confirmed stopped”. Unknown in-flight outcomes require reconciliation, never blind retry.

A resume action must require a separate explicit operator authorization, a recorded reason, and a new stop epoch. Resume must not automatically replay tasks whose external outcome is unknown.

## External side-effect idempotency

Task-level reservation idempotency is insufficient for publishing or other remote effects. Add a separate effect ledger keyed by a stable `effect_id` derived from task ID + named action (not from mutable content).

Suggested effect states:

- `prepared`: immutable target allowlist, content digest, effect ID, and destination idempotency key recorded before the call.
- `submitted`: request sent; response not yet reconciled.
- `confirmed`: destination response or read-after-write confirms the expected effect.
- `rejected`: destination definitively rejected it.
- `unknown`: timeout, connection loss, or ambiguous response; must reconcile before retry.

For destinations supporting idempotency keys, always reuse the same destination key. For destinations without that support, use a read-before-retry reconciliation procedure and require human review when uniqueness cannot be established. Never claim exactly-once behavior across a network boundary.

Publishing additionally requires content approval/provenance, destination allowlists, immutable content digest, preview evidence, audit trail, and a tested takedown/rollback path.

## Required tests before implementation can be enabled

- Two executors race to claim one queued task: exactly one lease is issued.
- Expired lease is reclaimed with a strictly higher fencing token.
- Old owner/token cannot heartbeat, complete, fail, or cancel after reclaim.
- Expired lease cannot be renewed.
- Pause and persistent stop block admission and new claims.
- Stop racing with claim is serialized; no claim is returned after stop commits.
- Stop racing with side-effect authorization is serialized; no new authorization is issued after stop commits.
- A worker checks the stop epoch before every outbound action.
- Ambiguous external result enters `unknown`; retry is blocked until reconciliation.
- Duplicate effect submissions reuse one stable destination idempotency key.
- Attempt cap and backoff prevent infinite retry and quota exhaustion.
- Restart/redeploy preserves lease, fencing, stop, and effect-ledger state.
- All errors and audit metadata are bounded and contain no secrets or article body.

## Rollout gates

1. Independent review of this protocol and the existing State Store.
2. Implement schema migration and transaction tests on the isolated branch only.
3. Run fault-injection and concurrency tests locally.
4. Independent security review of the implementation and exact-head CI.
5. Verify Free-tier headroom and billing visibility; published quotas are not remaining quota.
6. Deploy only a separate Preview Worker with execution disabled and paused.
7. Prove operator stop and recovery in Preview before any executor is connected.
8. Treat every publishing destination as a separate approval and credential boundary.

Until all gates pass, `POST /run` remains `501 execution_not_implemented` and no autonomous execution is claimed.
