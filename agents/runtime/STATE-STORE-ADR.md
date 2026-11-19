# Agent Runtime state store — architecture decision

Status: **proposed; not implemented, not bound, and not deployed**.

Date: 2026-11-19

## Decision

Use one isolated, SQLite-backed Cloudflare Durable Object as the coordination authority for the Preview Agent Runtime, provided the account remains on the Workers Free plan and the design is validated locally before any deployment.

The first iteration should use one stable logical object (for example, `agent-runtime-global`) so all task admissions, idempotency reservations, daily counters, and in-flight counts are serialized through one strongly consistent authority. This is intentionally a low-volume single-queue design, not a horizontal high-throughput architecture.

Do not use Workers KV for admission counters: its eventual-consistency behavior is unsuitable as the sole authority for atomic quota reservations. Do not use process memory or per-Worker instance maps for any durable state.

## Why SQLite-backed Durable Objects

Cloudflare documents SQLite-backed Durable Objects as available on Workers Free. The published Free allowances include 100,000 Durable Object requests/day, 13,000 GB-s/day, 100,000 SQL rows written/day, and 5 GB of account storage. The Free plan does not silently provide unlimited usage: operations that exceed a Free allowance fail. The project must therefore fail closed on storage/coordination errors and operate below explicit internal budgets.

The Worker Free plan also has its own request and CPU limits. Durable Object usage is a separate metered dimension; do not equate Worker request allowance with Durable Object allowance.

Official references:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

## Transaction boundary

A single admission operation must perform the following in one synchronous SQLite transaction:

1. Validate the task contract and operator authorization before calling the store.
2. Look up the idempotency key. If already reserved, return the existing task state without incrementing counters.
3. Read the current UTC day bucket and daily accepted count.
4. Read the current in-flight count from durable task rows.
5. Check the configured daily, concurrency, and payload limits.
6. Insert the task reservation and increment the daily accepted count.
7. Commit both changes together; on any exception, roll back both.

Use the Durable Object SQLite `transactionSync(callback)` API; do not issue SQL `BEGIN` or `SAVEPOINT` statements through `sql.exec()`. The callback must remain synchronous. Keep all SQL parameters bound; never interpolate untrusted strings into SQL.

## Minimum schema proposal

- `runtime_meta`: schema version and explicit runtime state (enabled/paused).
- `daily_usage`: UTC day primary key, accepted count.
- `tasks`: opaque task ID, unique idempotency key, allowlisted type, bounded payload JSON, state, created/updated timestamps, and optional bounded error code.
- `audit_events`: append-only event ID, task ID, event type, timestamp, and non-sensitive metadata only.

Required constraints:
- UNIQUE idempotency key.
- CHECK constraints for task state and allowed task types.
- No credentials, bearer tokens, article body contents, or personal data in audit rows.
- Store only the minimal task payload already accepted by the task contract.
- No arbitrary SQL or caller-supplied table/column names.

## State transitions

Allowed initial states: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

Only the store may perform valid transitions. In-flight count is derived from durable rows in `queued` or `running` states, not a Worker memory counter. Terminal transitions must be idempotent and must not decrement capacity twice.

A lease/heartbeat and crash-recovery policy is a separate gate. Do not auto-requeue stale work until lease expiry, retry limits, and duplicate side-effect behavior are specified and tested.

## Failure behavior

- Missing binding, SQL error, transaction failure, unknown schema version, or exhausted storage: reject admission; never fall back to memory.
- Duplicate idempotency key: return the original reservation; do not create a second task.
- Daily limit reached, concurrency full, or payload too large: reject with a stable machine-readable reason.
- Store failure must not be represented as successful acceptance.
- Keep `AGENT_ENABLED=false` and `AGENT_PAUSED=true` until all independent gates pass.

## Free-tier operating budget

The Cloudflare Free limits are platform ceilings, not an operating target. Initial internal guardrails should be materially lower and configurable, with conservative row-write budgeting and bounded retention. A storage write budget must account for every task transition and audit row, not just task creation.

No paid upgrade, payment method, billing change, or spend commitment is permitted. If a required feature is unavailable on the Free plan, stop and redesign rather than upgrading.

## Not approved by this ADR

- No Durable Object namespace/binding or migration is added to Wrangler yet.
- No Cloudflare deployment, secret configuration, alarm, cron trigger, queue consumer, or public endpoint is enabled.
- No task execution, external side effects, backup/restore promise, or 24/7 claim is authorized.
- No Production Worker, DNS, D1, or live data is changed.

## Implementation gates

1. Add the SQLite-backed Durable Object class and schema migrations in the isolated Runtime branch.
2. Add a local Cloudflare runtime integration harness (not a hand-written mock as the only test) and test transaction rollback, duplicate keys, concurrent admissions, quota boundaries, terminal transitions, and restart persistence.
3. Add Wrangler binding/migration only for the separate Preview Worker; extend CI to prove no Production resources are referenced.
4. Validate Free-plan compatibility and expected row/request budget before any Preview deployment.
5. Deploy only after explicit Preview-only credentials/permissions are available; keep the runtime disabled and paused.
