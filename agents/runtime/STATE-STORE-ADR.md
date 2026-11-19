# Agent Runtime state store — architecture decision

Status: **SQLite Durable Object implementation added to the isolated branch; local runtime validation is being added; not bound, not deployed, and not connected to task execution**.

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

- \`runtime_meta\`: schema version.
- \`daily_usage\`: UTC day primary key and accepted count.
- \`tasks\`: opaque task ID, unique idempotency key, allowlisted type, validated minimal payload JSON, payload hash/size, state, timestamps, and optional bounded error code.
- \`audit_events\`: event ID, task ID, event type, timestamp, and non-sensitive metadata only.

Constraints include a unique idempotency key, CHECK constraints for task state/type, bounded payload size, and bounded audit metadata. No credentials, bearer tokens, article body contents, or personal data are stored in audit rows.

## State transitions

- \`queued -> running\` or \`queued -> cancelled\`
- \`running -> succeeded\`, \`running -> failed\`, or \`running -> cancelled\`
- Repeating the same terminal transition is idempotent; attempting to reopen or change a terminal state is rejected.
- In-flight count is derived from durable task rows; terminal transitions do not decrement a separate counter.

Crash leases, automatic requeue, retry policy, and external side-effect idempotency are deliberately not implemented.

## Retention and budgets

- Internal ceilings: 1,000 task reservations/day, 100 in-flight tasks, and 8 KiB per serialized task request.
- Terminal task rows are retained for 30 days; audit and daily-usage rows are retained for 90 days. Idempotency protection is bounded by the 30-day task retention.
- The state store writes task, daily usage, and audit rows on admission; state transitions update task rows and append audit events. The workflow must measure actual row-write behavior before any live Preview binding.
- These internal limits are conservative guardrails, not evidence of remaining account quota or guaranteed availability.

## Failure behavior

- Missing binding, SQL error, transaction failure, unsupported schema version, invalid limit configuration, or exhausted storage: reject; never fall back to memory.
- Duplicate idempotency key: return the original reservation; do not create a second task.
- Daily limit reached, concurrency full, or payload too large: reject with a stable machine-readable reason.
- Store failure must never be represented as successful acceptance.
- Keep \`AGENT_ENABLED=false\` and \`AGENT_PAUSED=true\` until all independent gates pass.

## Not approved by this ADR

- No Durable Object namespace/binding or migration is added to the checked-in Preview Worker config.
- No Cloudflare Agent Runtime deployment, secret configuration, alarm, cron trigger, queue consumer, or public endpoint is enabled.
- No task execution, external side effects, backup/restore promise, or 24/7 claim is authorized.
- No Production Worker, DNS, D1, or live data is changed.

## Implementation gates

1. Review the implementation and run the Miniflare/workerd SQLite integration suite, including rollback, duplicate keys, concurrent admissions, quota boundaries, terminal transitions, UTC day rollover, and restart persistence.
2. Review Free-plan request and SQL-row budgets against actual expected workload.
3. Only after those gates pass, add a Durable Object binding and SQLite migration to a separate Runtime Preview config; keep the existing preview config unchanged.
4. Deploy only after Preview-only permissions are available; keep the runtime disabled and paused.
5. Add operator-only enqueue/inspect paths and task execution only after independent security, side-effect idempotency, recovery, kill-switch, and monitoring reviews.
