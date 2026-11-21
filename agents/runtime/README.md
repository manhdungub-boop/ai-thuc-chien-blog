# AI Thuc Chien Agent Runtime — Preview shell

Status: **isolated validation scaffold with a code-only, opt-in scheduled dispatcher; no Agent Runtime Worker deployment and no autonomous task execution**.

## Safety boundary

- Separate intended Worker name: \`ai-thuc-chien-agent-runtime-preview\`.
- `wrangler.jsonc` is the no-binding validation shell. `wrangler.preview.jsonc` is a separate, dedicated Preview deployment config that binds only the SQLite `AgentStateStore` Durable Object; it has no account ID, production route, custom domain, D1/KV/R2/service binding, secret, or queue consumer. Preview has no Cron Trigger; it sets `AGENT_SCHEDULER_ENABLED=false`, `AGENT_ENABLED=false`, and `AGENT_PAUSED=true`; the config is not deployed.
- \`AGENT_ENABLED=false\` and \`AGENT_PAUSED=true\` are the checked-in defaults.
- \`POST /run\` fails closed while disabled or paused.
- If both flags are manually opened, \`POST /run\` requires an \`Authorization: Bearer\` token matching the externally injected \`AGENT_OPERATOR_TOKEN\`; missing or invalid credentials fail closed with \`401\`.
- `POST /run` performs a bounded, operator-authenticated, synchronous review of at most five tasks per request. Each task is reserved in the SQLite Durable Object State Store, claimed with a fenced lease, reviewed using the fixed public GitHub `main`-branch read-only source adapter, then marked `succeeded` or `failed` through the State Store.
- Task admission, idempotency keys, queue state, daily accepted count, concurrency limit, leases, terminal task status, and bounded structured review findings are persisted by the State Store. Completion accepts only a strict result schema (at most 20 findings / 4 KiB); the result is available through the authenticated internal task lookup and is never copied from source documents.
- The Preview source adapter has no caller-controlled URL, credential, write API, or filesystem access. SEO tasks fail closed because trusted live HTTP-status and broken-link evidence is not yet available; the system does not fabricate a clean SEO result.
- The scheduled handler remains dormant code. The Preview config has no Cron Trigger, and scheduler/recovery/runtime flags remain disabled. Do not add a trigger until quota headroom, CPU, recovery, kill-switch and rollback gates pass. This is not a running background executor or 24/7 service. `GET /health` still reports the current operator-triggered capability and does not imply background operation.
- State Store routes are connected to the operator-triggered \`POST /run\` path and bounded \`/internal/dispatch\` path for reserve, claim and completion. \`/internal/recover\` remains manually invoked; the separate recovery alarm is disabled, and no Cron dispatcher is configured in the Preview file.

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
- Durable Object recovery alarms are not cost-free: each \`setAlarm()\` is one SQLite row write and each alarm invocation is one Durable Object request. The former 48-invocation/day Cron model is a historical planning scenario only; the current Preview config has no Cron Trigger. If a future release proposes that cadence, re-evaluate DO requests, heartbeat/audit/retention SQL writes, alarm invocations and Worker CPU against measured account usage before enabling it. No scheduled usage is currently observed.
- An operator-authenticated `POST /internal/enqueue` endpoint now admits one to five validated tasks into the durable queue without executing them. Admission is idempotent and subject to the existing State Store daily/in-flight caps. `POST /internal/dispatch` separately drains at most five already-queued tasks through read-only review handlers.
- A bounded operator queue-dispatch endpoint (`POST /internal/dispatch`) and atomic State Store `/claim-next` operation exist. They require operator authentication and the runtime/durable pause gates, accept a maximum batch of five, claim only the oldest due queued task with lease fencing, and run the existing read-only review handlers. The `scheduled()` handler remains guarded in source but is not reachable through a configured Cron Trigger; it remains disabled and undeployed. Dispatch renews a long-running task lease every two minutes and fails closed if renewal fails. It cannot publish or mutate the blog.
- A bounded lease-recovery alarm handler now exists in source. It is explicitly gated by \`AGENT_RECOVERY_ALARM_ENABLED=true\` in addition to the runtime enabled/unpaused gates and the durable pause control. Preview sets this flag to \`false\`. When enabled, one shared alarm is scheduled from active lease expiries with a five-minute minimum cadence; each invocation recovers at most five expired leases, records an audit event, and never claims or executes queued work. Paused/disabled invocations clear the alarm. This is recovery automation only, not a task scheduler or 24/7 executor; it remains un-deployed and un-enabled.
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
- The Worker contains an operator-authenticated `POST /internal/recover` bridge. It requires both outer runtime gates to be explicitly open, injects the configured operator identity and a server-generated request ID, and forwards only the dedicated internal State Store credential. The State Store enforces a per-actor rate limit and records actor/request ID in the recovery audit event. The bridge is implemented and covered by isolated Worker tests, but remains unavailable until the dedicated Preview Worker is deployed with Preview-only secrets and binding. `AGENT_ENABLED` and `AGENT_PAUSED` remain independent deployment-level outer gates. A persisted Resume cannot bypass those gates or dispatch queued work.
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


- `src/repository-readers.mjs` is a Node-only, read-only CI/build adapter for the checked-out repository. It reads only allowlisted article HTML, `data/ai-tools.json`, and sitemap entries; resolves real paths and rejects traversal/symlink escapes; enforces byte limits; and never writes. It is deliberately not imported by the Cloudflare Worker entrypoint.
- SEO HTTP status and broken-link counts are not inferred from local files. The repository reader requires an explicit `seoEvidenceReader` provider for those facts; sitemap membership is independently derived from the checked-out `sitemap.xml`.
- Integration tests now inspect the real article, AI Bank catalog and sitemap in the checked-out repository. This validates local source reading, not a live website HTTP crawl or a deployed agent.

## Read-only Audit Integrity Inspector

- `src/audit-integrity-inspector.mjs` cross-checks caller-supplied task snapshots against audit events using the actual State Store event vocabulary: queued, claimed, heartbeat, terminal outcomes and lease-expiry recovery.
- Detects duplicate task/event IDs, missing or unknown events, invalid lifecycle transitions, lease-generation mismatches, inconsistent lease/terminal fields, timestamp regressions and task/audit-tail disagreement.
- Task rows are retained for 30 days while audit events are retained for 90 days. An audit event whose task is missing only after the task-retention window is therefore a warning, not automatically corruption.
- Bounded to 1,000 tasks and 5,000 events. Timestamp ties are explicitly marked ambiguous because the current audit schema has no monotonic sequence column.
- Pure analysis only: no database reads, source authentication, audit deletion detection, repair, retry or task execution. The inspector cannot prove that records were never tampered with or removed.

## Read-only Health Monitor and Manual Recovery Planner

- `src/agent-health-monitor.mjs` evaluates a fresh caller-supplied snapshot of State Store, Worker bridge and usage-evidence status, heartbeat age, queue/running counts and expired leases. It does not poll services or prove continuous uptime.
- Missing, stale, future-dated, malformed or out-of-bound observations fail closed. Unavailable components or expired leases produce a critical status; warnings produce degraded status.
- `src/agent-recovery-planner.mjs` creates a human/operator checklist. Critical cases recommend manual pause if running, inspection and reconciliation before any later release review.
- The planner never invokes Pause, Resume, lease recovery, retries, or task execution. Auto-resume remains prohibited.

## Usage Evidence Collector and Runtime Admission Controller

- `src/usage-evidence-collector.mjs` validates a caller-supplied Cloudflare usage snapshot: source label, redacted account reference, observation timestamp, freshness, resource names, used values and limits. It performs no network call and does not authenticate the source.
- A `valid_free_plan_claim` is only a structurally valid, caller-supplied claim. It is not independent proof of Free plan status, remaining quota, or future headroom. Owner-supplied Billing evidence verifies Workers Free and Durable Objects Free plan labels, but remaining service-level quota headroom is unverified.
- `src/runtime-admission-controller.mjs` composes safety, usage-evidence and abstract internal-budget checks into a dry-run decision. It blocks unknown/paid/stale usage evidence and unsafe runtime snapshots.
- Even an eligible dry-run result means only "eligible for separate release review"; it never authorizes deployment, task enqueue, reservation persistence, or execution. No Agent Runtime Worker is deployed or enabled.

## Read-only Budget Guard and Priority Engine

- `src/agent-priority-engine.mjs` assigns fixed deterministic weights to the allowlisted task families and preserves input order for ties. It does not mutate or execute tasks.
- `src/agent-budget-guard.mjs` validates a caller-supplied, explicitly verified ledger snapshot and allocates bounded abstract internal capacity units in priority order. Missing or inconsistent evidence fails closed.
- These units are not currency, model tokens, Cloudflare billing units, or provider quotas. This pure helper does not fetch usage, persist reservations, charge money, or prove that any external service is on a free tier.
- The current daily ceiling of 100 abstract units is an application-level safety ceiling, not an observed provider limit. No scheduler or runtime integration is enabled.

## Read-only Safety Supervisor

- `src/agent-safety-supervisor.mjs` evaluates a caller-supplied boolean evidence snapshot and fails closed when any required evidence is absent.
- It flags enabled/unpaused runtime state, scheduler or executor configuration before approval, and production bindings. An unverified Cloudflare budget remains a warning and never grants deployment permission.
- The supervisor does not poll, change runtime state, invoke Pause, deploy, or trigger tasks. It is a pure policy evaluator, not a live 24/7 monitoring service.
- The safe idle result still instructs operators to keep the runtime disabled until the separate release gates are explicitly satisfied.

## Read-only Agent Manager

- `src/read-only-agent-manager.mjs` coordinates a bounded batch of up to 20 validated review tasks in a deterministic sequential order.
- It obtains snapshots only through the injected read-only adapter, applies the existing pure Task Handlers, and produces per-task findings plus a severity-prioritized aggregate report.
- Invalid tasks and duplicate idempotency keys are rejected before an additional source read. A failed source read is isolated to that item; subsequent tasks can continue.
- The manager has no State Store, filesystem, network, Worker binding, scheduler, retry, enqueue, publish, or execution capability. It does not persist reports. This is a local orchestration/reporting layer, not an autonomous agent or 24/7 service.

## Read-only source snapshot adapters

- `src/task-snapshot-adapters.mjs` converts an already-authorized source read into a bounded metadata snapshot for the pure task handlers.
- It accepts only three injected read capabilities: `readArticleHtml(articlePath)`, `readAiBankCatalog()`, and `readSeoPage(path)`. Task payloads are validated before any reader is invoked; article and route identifiers are passed unchanged and are never converted into arbitrary URLs.
- Article snapshots extract title, description, canonical, author, BlogPosting JSON-LD presence, attribution-note presence, visible-text word count, and relative internal-link count.
- AI Bank snapshots use the repository catalog schema (`tools[].id/name/vendor/website/official_sources/pricing_model/pricing_status/last_verified/verification_status`) and detect duplicate names or website hostnames within that catalog.
- SEO readers must explicitly supply HTTP status, sitemap membership, and broken-internal-link count alongside bounded HTML. The adapter does not guess sitemap or broken-link status.
- Each HTML source is capped at 512 KiB; the AI catalog is capped at 512 KiB and 1,000 entries. Source failures, missing records, malformed results and oversize data fail closed with generic errors.
- The adapter has no filesystem, network, `fetch`, Worker binding, write, publish, or executor capability. The injected reader functions are an interface contract only; production/Preview readers are not wired and no live repository or Worker data is being read by this module.
- Adapter tests use in-memory fixtures. Passing the adapter tests does not establish a deployed data connection.

## Remaining gates

1. Independently review the schema migration, lease transactions, auth boundary, and integration-test evidence.
2. Review the Free-tier request/SQL-row budget including heartbeat and recovery audit writes against measured workload.
3. Independently review the new dedicated `wrangler.preview.jsonc`, SQLite migration, and Worker class export.
4. Deploy the separate Preview Worker only after all local gates pass and Preview-only permissions are explicitly available; inject both tokens as Preview-only secrets without exposing them in repository files.
5. Add an execution engine only after read-only task handlers, idempotency, cancellation, kill-switch behavior, and monitoring are independently reviewed.
6. Add alarms or schedules only after recovery, quota pause behavior, and rollback are proven.

This scaffold makes no claim of 24/7 execution, backup readiness, or production recovery.


## Preview URL and operator exposure

The dedicated Preview config sets `workers_dev=true` and `preview_urls=true`; if deployed, its workers.dev/Preview URL is publicly reachable unless an access-control layer is added. `/health` exposes only non-sensitive gate state. Operator routes require server-side bearer validation, but the current shared token/static actor label do not provide named-human identity, MFA, browser-safe sessions, or global ingress rate limiting. Do not put either secret in browser code. A no-cost Access/session boundary and actual service-level quota headroom must be verified before deployment; the Workers and Durable Objects Free plan labels have been confirmed from the account Billing pages. The separate Preview config remains undeployed until those gates pass.


## GitHub Actions OIDC emergency-pause bridge (code-only)

The Worker now has a separate `POST /internal/oidc/pause` route. It accepts only a short-lived GitHub Actions JWT, verifies it against signing keys obtained from GitHub's fixed issuer discovery/JWKS endpoints, pins the expected repository/owner IDs, main ref, exact workflow ref, custom audience, `workflow_dispatch` event, and a configured actor ID, then atomically consumes the token `jti` in the State Store before recording a durable Pause action. It does not accept the shared operator bearer, does not expose Resume, and does not enqueue or execute tasks.

The dedicated Preview config sets `AGENT_OIDC_ENABLED=false`. It includes the exact repository/owner identifiers and workflow/ref/audience policy. `AGENT_OIDC_ACTOR_ID` is pinned to `342528485`, observed as the triggering actor ID (`manhdungub-boop`) in GitHub Actions run #317. The OIDC feature flag remains false, so this identity is not yet active. The new manual workflow `.github/workflows/agent-runtime-operator.yml` requests `id-token: write` only for a manually dispatched pause operation and requires the non-secret repository variable `AGENT_RUNTIME_PREVIEW_URL`; that variable is not configured here. No OIDC token, Cloudflare secret, or Preview URL is committed.

The repository was created on 2026-10-17. GitHub's current documentation says repositories created after 2026-07-15 use immutable default OIDC subjects containing owner and repository IDs; the verifier's expected subject is pinned to that immutable format. This is verified against GitHub's OIDC reference, but the actual workflow token has not yet been obtained or tested against a live Worker.

This is a code-level emergency-pause path only. It is not human MFA, it cannot resume the runtime, and it does not establish that the Preview Worker is deployed. Keep it disabled until the Preview URL, measured Free-tier headroom, and dedicated Preview access boundary are verified.
