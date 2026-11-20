# AI Thuc Chien Agent Runtime — Preview shell

Status: **isolated validation scaffold; no Agent Runtime Worker deployment and no autonomous task execution**.

## Safety boundary

- Separate intended Worker name: \`ai-thuc-chien-agent-runtime-preview\`.
- `wrangler.jsonc` is the no-binding validation shell. `wrangler.preview.jsonc` is a separate, dedicated Preview deployment config that binds only the SQLite `AgentStateStore` Durable Object; it has no account ID, production route, custom domain, D1/KV/R2/service binding, secret, cron trigger, or queue consumer. Both configs keep `AGENT_ENABLED=false` and `AGENT_PAUSED=true`.
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
- `src/state-store.mjs` implements the SQLite-backed Durable Object class with transactional schema v1-to-v5 migrations, durable idempotency, UTC daily counters, atomic admission reservations, fenced claims, bounded heartbeats, operator-invoked expiry recovery and terminal completion. The class is bound only in `wrangler.preview.jsonc`; the validation-only `wrangler.jsonc` remains unbound. Every state-changing lease operation writes an audit event transactionally.
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
- State Store schema v3 adds durable pause state and control audit; schema v4 adds a durable per-actor mutation limit of 10 control changes per 60-second window; schema v5 stores SHA-256 digests of consumed GitHub OIDC `jti` values in an atomic replay ledger. Control audit records the configured actor, request ID, action, reason, and timestamp transactionally. The replay ledger is an internal State Store primitive only; it is not bridged by the Worker, does not verify JWTs, and does not authorize operator actions.
- The actor is a configured service/operator identity, not proof of an individual human identity. The current bearer is a shared secret; there is no browser session, MFA, per-user identity provider, or public admin UI. Do not expose these endpoints to browser clients or distribute the bearer token.
- The Worker now contains an operator-authenticated `POST /internal/recover` bridge. It requires both outer runtime gates to be explicitly open, injects the configured operator identity and a server-generated request ID, and forwards only the dedicated internal State Store credential. The State Store enforces a per-actor rate limit and records actor/request ID in the recovery audit event. This bridge is code-only pending Preview binding and independent review. `AGENT_ENABLED` and `AGENT_PAUSED` remain independent deployment-level outer gates. A persisted Resume cannot bypass those gates or dispatch queued work.
- The dedicated `wrangler.preview.jsonc` now declares the isolated SQLite State Store binding and migration, but it has not been deployed. The required `AGENT_STATE_STORE_TOKEN` and `AGENT_OPERATOR_TOKEN` remain external secrets and must be provisioned only in the dedicated Preview Worker after permission review. Until then, the bridge routes cannot operate in a live deployment. Local integration tests use Miniflare only.
- The State Store's internal `POST /oidc/replay/consume` route is protected by the distinct Worker-to-State-Store bearer and is not exposed as a public Worker route. The dedicated `POST /internal/oidc/pause` Worker handler verifies GitHub JWT signature and pinned claims before calling it. It accepts only `jti` plus verified-token expiry metadata, hashes the identifier before storage, enforces single use transactionally, and fails closed when storage is unavailable. This code path remains disabled in Preview config and undeployed.


## Read-only task handlers (pure analysis only)

- `src/task-handlers.mjs` accepts an already-read, normalized metadata snapshot and returns a deterministic report for the three allowlisted task types.
- `content.review` checks the article reference, title/description, canonical URL, DUNG - AI author, BlogPosting JSON-LD, attribution note, word count and internal-link count.
- `ai_bank.candidate_review` checks candidate identity, HTTPS website/source URLs, pricing metadata, verification date/status and a duplicate-record signal.
- `seo.audit` checks HTTP status, title/description, HTTPS canonical, indexability, JSON-LD, sitemap presence and internal-link counts.
- Snapshots are exact-schema, bounded to 16 KiB, and reports are bounded to 20 findings. Results contain only finding codes/messages and no copied source text.
- This module is deliberately pure: it does not fetch files, access the State Store, call external services, mutate the catalog, edit articles, publish content, enqueue tasks, or invoke an executor. The read-only data adapters that would obtain snapshots are not implemented yet.
- All reports explicitly say `execution: not_started` and `sideEffects: []`. A finding is a review signal, not permission to auto-correct or publish.

## Remaining gates

1. Independently review the schema migration, lease transactions, auth boundary, and integration-test evidence.
2. Review the Free-tier request/SQL-row budget including heartbeat and recovery audit writes against measured workload.
3. Independently review the new dedicated `wrangler.preview.jsonc`, SQLite migration, and Worker class export.
4. Deploy the separate Preview Worker only after all local gates pass and Preview-only permissions are explicitly available; inject both tokens as Preview-only secrets without exposing them in repository files.
5. Add an execution engine only after read-only task handlers, idempotency, cancellation, kill-switch behavior, and monitoring are independently reviewed.
6. Add alarms or schedules only after recovery, quota pause behavior, and rollback are proven.

This scaffold makes no claim of 24/7 execution, backup readiness, or production recovery.


## Preview URL and operator exposure

The dedicated Preview config sets `workers_dev=true` and `preview_urls=true`; if deployed, its workers.dev/Preview URL is publicly reachable unless an access-control layer is added. `/health` exposes only non-sensitive gate state. Operator routes require server-side bearer validation, but the current shared token/static actor label do not provide named-human identity, MFA, browser-safe sessions, or global ingress rate limiting. Do not put either secret in browser code. A no-cost Access/session boundary and the actual account Free-plan/usage headroom must be verified before deployment. The separate Preview config remains undeployed until those gates pass.


## GitHub Actions OIDC emergency-pause bridge (code-only)

The Worker now has a separate `POST /internal/oidc/pause` route. It accepts only a short-lived GitHub Actions JWT, verifies it against signing keys obtained from GitHub's fixed issuer discovery/JWKS endpoints, pins the expected repository/owner IDs, main ref, exact workflow ref, custom audience, `workflow_dispatch` event, and a configured actor ID, then atomically consumes the token `jti` in the State Store before recording a durable Pause action. It does not accept the shared operator bearer, does not expose Resume, and does not enqueue or execute tasks.

The dedicated Preview config sets `AGENT_OIDC_ENABLED=false`. It includes the exact repository/owner identifiers and workflow/ref/audience policy. `AGENT_OIDC_ACTOR_ID` is pinned to `342528485`, observed as the triggering actor ID (`manhdungub-boop`) in GitHub Actions run #317. The OIDC feature flag remains false, so this identity is not yet active. The new manual workflow `.github/workflows/agent-runtime-operator.yml` requests `id-token: write` only for a manually dispatched pause operation and requires the non-secret repository variable `AGENT_RUNTIME_PREVIEW_URL`; that variable is not configured here. No OIDC token, Cloudflare secret, or Preview URL is committed.

The repository was created on 2026-10-17. GitHub's current documentation says repositories created after 2026-07-15 use immutable default OIDC subjects containing owner and repository IDs; the verifier's expected subject is pinned to that immutable format. This is verified against GitHub's OIDC reference, but the actual workflow token has not yet been obtained or tested against a live Worker.

This is a code-level emergency-pause path only. It is not human MFA, it cannot resume the runtime, and it does not establish that the Preview Worker is deployed. Keep it disabled until the Preview URL, Free-tier headroom, and dedicated Preview access boundary are verified.
