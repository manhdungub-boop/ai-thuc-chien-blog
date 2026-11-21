# AI Thuc Chien Agent Runtime — Preview shell

Status: **isolated Preview implementation with bounded read-only task handlers and operator control/recovery code; no deployed Agent Runtime Worker and no autonomous or external-side-effect execution**.

## Safety boundary

- Separate intended Worker name: \`ai-thuc-chien-agent-runtime-preview\`.
- The standard `wrangler.jsonc` remains unbound and has no account ID, Production route, custom domain, D1/KV/R2 binding, secret, Cron trigger, or queue consumer. The separate `wrangler.preview.jsonc` defines one isolated SQLite Durable Object binding; it has no `triggers` entry and all runtime gates remain closed.
- \`AGENT_ENABLED=false\` and \`AGENT_PAUSED=true\` are the checked-in defaults.
- \`POST /run\` fails closed while disabled or paused.
- If both flags are manually opened, `POST /run` requires the external `AGENT_OPERATOR_TOKEN`, a valid bounded task batch, and the dedicated State Store binding/token. It can run only allowlisted read-only handlers; source failures fail closed and no article publishing, social posting, or other external side effect is implemented. Preview gates remain closed and required secrets are not configured.
- Operator bearer validation uses SHA-256 digests with constant-time byte comparison. The secret is never committed, logged, or returned; no secret is configured in this repository.
- \`GET /health\` returns only non-sensitive state.
- No Agent Runtime Production deploy workflow is authorized. CI runs local tests and static configuration checks; any Cloudflare Preview build is not Production deployment approval.

## Implemented validation-only building blocks

- \`src/task-contract.mjs\` accepts only \`content.review\`, \`ai_bank.candidate_review\`, and \`seo.audit\`; exact payload keys, bounded size, safe local paths, and idempotency-key syntax are enforced.
- `src/operator-auth.mjs` validates the externally supplied operator bearer token and fails closed when the secret is absent or weak; the OIDC pause path has a separate exact-claim verifier.
- \`src/admission-policy.mjs\` remains a pure fail-closed policy helper; it is not the quota authority.
- \`src/internal-auth.mjs\` validates a dedicated \`AGENT_STATE_STORE_TOKEN\`, separate from the external operator token.
- \`src/lease-policy.mjs\` defines bounded claim, heartbeat, recovery and completion rules, including a 30-minute absolute lease lifetime and three attempts by default.
- `src/state-store.mjs` implements a SQLite-backed Durable Object class. The dedicated Preview config defines its binding while the standard Worker config remains unbound. It supports transactional schema v1-to-v7 migrations, durable idempotency, UTC daily counters, bounded external-request budgets, atomic admission reservations, fenced claims, bounded heartbeats, bounded result persistence, operator recovery, and terminal completion. Every state-changing lease operation writes an audit event transactionally.
- The Worker source connects bounded read-only handlers to the State Store and exposes a server-side operator recovery bridge. A Durable Object alarm can requeue expired leases only, but `AGENT_RECOVERY_ALARM_ENABLED=false`; the scheduled queue dispatcher is gated off by `AGENT_SCHEDULER_ENABLED=false`, and no Cron trigger is configured. Neither path executes queued work automatically in the current Preview configuration.

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

## Limits and retention

- Enforced pilot ceilings: 100 accepted tasks/day, 5 in-flight tasks, and 8 KiB serialized task request. These are code limits, not measured provider quota.
- Daily usage is counted in UTC. In-flight usage is derived from rows in \`queued\` or \`running\`, not an in-memory counter.
- Completed/failed/cancelled task rows are retained for 30 days; audit events and daily-usage rows are retained for 90 days. Idempotency protection therefore lasts for the task-retention period.
- Storage errors, unsupported schema versions, and invalid limits fail closed. There is no memory fallback.
- These are internal guardrails, not proof of remaining Cloudflare account quota or a guarantee of uninterrupted service.

## Durable state-store decision

See [STATE-STORE-ADR.md](./STATE-STORE-ADR.md) for the design decision, Free-tier budget, transaction boundary, failure behavior, and remaining gates.

## Operator control-plane status

- The Worker shell exposes a narrow server-side operator bridge: `GET /internal/control`, `POST /internal/control/pause`, `POST /internal/control/resume`, and `POST /internal/recover`. It also has a manual, pause-only `POST /internal/oidc/pause` path, disabled by default.
- The Worker generates the request ID and actor field; caller-supplied actor values are rejected. The Worker forwards only the dedicated `AGENT_STATE_STORE_TOKEN` to the fixed Durable Object identity. Caller cookies and arbitrary headers are never forwarded.
- State Store schema v3 adds durable pause state and control audit; v4 adds the per-actor mutation limit; v5 adds the OIDC `jti` replay ledger; v6/v7 reconcile external-request budgets and bounded task-result persistence. The OIDC pause route verifies the configured GitHub Actions identity and consumes the replay ledger before pausing.
- The actor is a configured service/operator identity, not proof of an individual human identity. The current bearer is a shared secret; there is no browser session, MFA, per-user identity provider, or public admin UI. Do not expose these endpoints to browser clients or distribute the bearer token.
- The Worker exposes `POST /internal/recover` using a configured service actor and server-generated request ID. The State Store applies a persistent per-actor rate limit and writes an audit event. This is service-identity attribution, not proof of a human identity; `AGENT_ENABLED` and `AGENT_PAUSED` remain independent outer gates.
- The dedicated Preview config defines the fixed Durable Object binding but no dedicated Runtime deployment or required secrets are verified. Local integration tests use Miniflare only; do not infer live service readiness from source or tests.
- The manual `POST /internal/oidc/pause` path uses the internal replay ledger after verifying configured GitHub Actions identity claims. It is pause-only and gated by `AGENT_OIDC_ENABLED=false`; it does not provide resume, a browser session, MFA, or person-level identity.
## Remaining gates

1. Independently review the schema migration, lease transactions, auth boundary, and integration-test evidence.
2. Review the Free-tier request/SQL-row budget including heartbeat and recovery audit writes against measured workload.
3. Independently review the existing Worker-to-State-Store call path, fixed Durable Object identity, dedicated internal token, and Preview-only binding/secrets before any deployment.
4. Deploy the separate Preview Worker only after all local gates pass and Preview-only permissions are explicitly available.
5. Keep the existing task handlers read-only and disabled until their idempotency, cancellation, kill-switch behavior, and monitoring are independently reviewed; do not add external-effect handlers yet.
6. Keep the recovery alarm and scheduled dispatcher disabled; no Cron trigger is configured. Enable either only after recovery, quota pause behavior, and rollback are proven.

This scaffold makes no claim of 24/7 execution, backup readiness, or production recovery.
