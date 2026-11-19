# AI Thuc Chien Agent Runtime — Preview shell

Status: **isolated validation scaffold; no Agent Runtime Worker deployment and no autonomous task execution**.

## Safety boundary

- Separate intended Worker name: \`ai-thuc-chien-agent-runtime-preview\`.
- No account ID, production route, custom domain, D1 binding, KV/R2 binding, Durable Object binding, secret, cron trigger, or queue consumer is configured in \`wrangler.jsonc\`.
- \`AGENT_ENABLED=false\` and \`AGENT_PAUSED=true\` are the checked-in defaults.
- \`POST /run\` fails closed while disabled or paused.
- If both flags are manually opened, \`POST /run\` requires an \`Authorization: Bearer\` token matching the externally injected \`AGENT_OPERATOR_TOKEN\`; missing or invalid credentials fail closed with \`401\`. A valid token still receives \`501 execution_not_implemented\`; no task execution exists.
- Operator bearer validation uses SHA-256 digests with constant-time byte comparison. The secret is never committed, logged, or returned; no secret is configured in this repository.
- \`GET /health\` returns only non-sensitive state.
- No deploy workflow is provided. CI only runs local tests and static configuration checks.

## Implemented validation-only building blocks

- \`src/task-contract.mjs\` accepts only \`content.review\`, \`ai_bank.candidate_review\`, and \`seo.audit\`; exact payload keys, bounded size, safe local paths, and idempotency-key syntax are enforced.
- \`src/operator-auth.mjs\` validates an externally supplied operator bearer token and fails closed when the secret is absent or weak.
- \`src/admission-policy.mjs\` remains a pure fail-closed policy helper; it is not the quota authority.
- \`src/internal-auth.mjs\` validates a dedicated \`AGENT_STATE_STORE_TOKEN\`, separate from the external operator token.
- \`src/lease-policy.mjs\` defines bounded claim, heartbeat, recovery and completion rules, including a 30-minute absolute lease lifetime and three attempts by default.
- \`src/state-store.mjs\` implements a SQLite-backed Durable Object class, but the class is **not bound** in the checked-in Preview Worker config. It supports transactional schema v1-to-v5 migrations, including bounded request parsing for every mutating State Store route, durable idempotency, UTC daily counters, atomic admission reservations, fenced claims, bounded heartbeats, operator-invoked expiry recovery and terminal completion. Every state-changing lease operation writes an audit event transactionally.
- State Store routes are not connected to \`POST /run\`; no task is enqueued or executed by the Worker shell. \`/recover\` is manually invoked; there is no alarm, cron or background scheduler.

## Local integration validation

The validation workflow installs the pinned open-source Miniflare simulator and runs the Durable Object against local \`workerd\` with SQLite enabled. Tests cover duplicate keys, payload conflicts, concurrent admission at quota boundaries, terminal transitions, UTC day rollover, transaction rollback, and persistence after a runtime restart.

From the repository root:

\`\`\`sh
npm install --no-save --no-package-lock --ignore-scripts miniflare@4.20260730.0
node --check agents/runtime/src/worker.mjs
node --check agents/runtime/src/state-store.mjs
node --check agents/runtime/src/lease-policy.mjs
node --check agents/runtime/src/internal-auth.mjs
node --test agents/runtime/tests/*.test.mjs
\`\`\`

The GitHub Actions workflow is authoritative for the test dependency tree: it applies isolated npm overrides for the patched `sharp` and `undici` versions and fails on remaining High/Critical advisories. This is local-runtime evidence, not a live Cloudflare deployment test. Miniflare is a development simulator, not a hardened security boundary.

Test-only schema downgrade, rollback probes, and deterministic clock overrides are isolated in `tests/fixtures/state-store-test-worker.mjs`, a Miniflare-only Durable Object subclass. The deployable State Store source contains no test routes, test-mode environment switch, or `x-test-now` clock override. Integration coverage also instantiates the deployable Worker module with the production State Store class and verifies that the fixture routes return 404 and the test clock header is ignored.

## Limits and retention

- Enforced pilot ceilings: 100 accepted tasks/day, 5 in-flight tasks, and 8 KiB serialized task request. These are code limits, not measured provider quota.
- Daily usage is counted in UTC. In-flight usage is derived from rows in \`queued\` or \`running\`, not an in-memory counter.
- Completed/failed/cancelled task rows are retained for 30 days; audit events and daily-usage rows are retained for 90 days. Idempotency protection therefore lasts for the task-retention period.
- Storage errors, unsupported schema versions, and invalid limits fail closed. There is no memory fallback.
- These are internal guardrails, not proof of remaining Cloudflare account quota or a guarantee of uninterrupted service.

## Durable state-store decision

See [STATE-STORE-ADR.md](./STATE-STORE-ADR.md) for the design decision, Free-tier budget, transaction boundary, failure behavior, and remaining gates.

## Operator control-plane status

- The Worker shell now exposes a narrow, server-side operator bridge: `GET /internal/control`, `POST /internal/control/pause`, and `POST /internal/control/resume`. All require the configured `AGENT_OPERATOR_TOKEN`; mutations also require a valid deployment-configured `AGENT_OPERATOR_ID`.
- The Worker generates the request ID and actor field; caller-supplied actor values are rejected. The Worker forwards only the dedicated `AGENT_STATE_STORE_TOKEN` to the fixed Durable Object identity. Caller cookies and arbitrary headers are never forwarded.
- State Store schema v5 adds a durable per-actor mutation limit of 10 control changes per 60-second window, writes the configured actor/request ID/action/reason/timestamp to the control audit table transactionally, and stores SHA-256 digests of consumed GitHub OIDC `jti` values in an atomic replay ledger. The replay ledger is an internal State Store primitive only; it is not bridged by the Worker, does not verify JWTs, and does not authorize operator actions.
- The actor is a configured service/operator identity, not proof of an individual human identity. The current bearer is a shared secret; there is no browser session, MFA, per-user identity provider, or public admin UI. Do not expose these endpoints to browser clients or distribute the bearer token.
- The control bridge does not expose `/recover`; recovery remains inaccessible through the Worker surface. `AGENT_ENABLED` and `AGENT_PAUSED` remain independent deployment-level outer gates. A persisted Resume cannot bypass those gates or dispatch queued work.
- No Worker-to-DO binding or secret is configured in the checked-in Preview config, so these bridge routes cannot operate in a live deployment yet. Local integration tests use Miniflare only.
- The State Store's internal `POST /oidc/replay/consume` route is protected by the distinct Worker-to-State-Store bearer and is not exposed by the Worker shell. It accepts only `jti` plus verified-token expiry metadata, hashes the identifier before storage, enforces single use transactionally, and fails closed when storage is unavailable. It must only be called after a future caller independently verifies the GitHub JWT signature and claims; that caller is not implemented.
## Remaining gates

1. Independently review the schema migration, lease transactions, auth boundary, and integration-test evidence.
2. Review the Free-tier request/SQL-row budget including heartbeat and recovery audit writes against measured workload.
3. Integrate the Worker-to-State-Store call path using only the fixed Durable Object identity and dedicated internal token; keep it in a separate Runtime Preview config.
4. Deploy the separate Preview Worker only after all local gates pass and Preview-only permissions are explicitly available.
5. Add an execution engine only after read-only task handlers, idempotency, cancellation, kill-switch behavior, and monitoring are independently reviewed.
6. Add alarms or schedules only after recovery, quota pause behavior, and rollback are proven.

This scaffold makes no claim of 24/7 execution, backup readiness, or production recovery.
