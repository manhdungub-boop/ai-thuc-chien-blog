# AI Thuc Chien Agent Runtime — Preview shell

Status: **dedicated Preview Worker is deployed and fail-closed; no autonomous task execution, scheduler, reviewer sign-in, AI inference, or publishing is enabled**.

> Current authoritative deployment record: [DEPLOYMENT-STATUS-20261123.md](./DEPLOYMENT-STATUS-20261123.md). Older no-deployment, no-namespace, no-Preview-secret, OIDC-disabled, and `preview_urls=true` statements later in this file are historical snapshots and are superseded by that record.

## Safety boundary

- Separate intended Worker name: \`ai-thuc-chien-agent-runtime-preview\`.
- `wrangler.jsonc` is the no-binding validation shell. `wrangler.preview.jsonc` is a separate, dedicated Preview deployment config that binds the SQLite `AgentStateStore`, `AgentReviewerAuthStore`, and `AgentDraftStore` Durable Objects plus the Cloudflare Workers Rate Limiting API. It has no account ID, production route, custom domain, D1/KV/R2/service binding, secret, or queue consumer. Preview deliberately declares no Cron Trigger. Account Billing Read is unavailable through the connected Cloudflare authorization, so the actual plan, Durable Object usage, request/SQL-row/GB-second headroom, and workload CPU remain unverified. `AGENT_SCHEDULER_ENABLED=false`, `AGENT_ENABLED=false`, and `AGENT_PAUSED=true` remain fail-closed defaults; scheduled handler code is present but cannot be invoked automatically by this config.
- `AGENT_ENABLED=false` and `AGENT_PAUSED=true` are the checked-in defaults.
- Preview requires the Cloudflare Workers Rate Limiting binding on every route, keyed by the edge-provided client IP, at 60 requests per minute per Cloudflare location. Counters are approximate and location-scoped, not a strict global cap. A missing/malformed client IP or unavailable binding fails closed with `503` rather than placing all callers into one fallback bucket. IP-based limits can affect multiple legitimate users sharing a NAT, VPN, or mobile carrier address; this trade-off is documented and must be considered before enabling Preview. Any future trusted scheduled dispatch must pass through the same operator bearer validation, pause/enable gates, bounded dispatcher, and State Store authorization. Public HTTP requests cannot set an internal scheduler marker. The no-binding validation config is unchanged.
- \`POST /run\` fails closed while disabled or paused.
- If both flags are manually opened, \`POST /run\` requires an \`Authorization: Bearer\` token matching the externally injected \`AGENT_OPERATOR_TOKEN\`; missing or invalid credentials fail closed with \`401\`.
- `POST /run` performs a bounded, operator-authenticated, synchronous review of at most five tasks per request. Each task is reserved in the SQLite Durable Object State Store, claimed with a fenced lease, reviewed using the fixed public GitHub `main`-branch read-only source adapter, then marked `succeeded` or `failed` through the State Store.
- Task admission, idempotency keys, queue state, daily accepted count, concurrency limit, leases, terminal task status, and bounded structured review findings are persisted by the State Store. Completion accepts only a strict result schema (at most 20 findings / 4 KiB); the result is available through the authenticated internal task lookup and is never copied from source documents.
- The Preview source adapter has no caller-controlled URL, credential, write API, or filesystem access. SEO tasks fail closed because trusted live HTTP-status and broken-link evidence is not yet available; the system does not fabricate a clean SEO result.
- The scheduled handler exists as code and hard-caps each invocation at one already-queued task. It is gated by `AGENT_SCHEDULER_ENABLED=true`, `AGENT_RECOVERY_ALARM_ENABLED=true`, the existing enabled/unpaused flags, and a valid operator bearer. The Preview config declares no Cron Trigger, so it cannot create recurring invocations. This is code-level scheduler support, not a running background executor or 24/7 service. A queued task left by an interrupted request remains visible for bounded lease recovery. `GET /health` still reports the current operator-triggered capability and does not imply background operation.
- State Store routes are connected to the operator-triggered \`POST /run\` path and bounded \`/internal/dispatch\` path for reserve, claim and completion. \`/internal/recover\` remains manually invoked; the separate recovery alarm is disabled, and the Cron dispatcher is not configured in the Preview file pending cost verification.

## Research-to-authoring scaffold — intentionally disabled

The integration branch contains a research-to-authoring preparation endpoint, but it is **intentionally fail-closed**. Every POST to `/internal/authoring/prepare` returns HTTP 503 with `authoring_route_disabled_pending_durable_pause_fencing` before authentication, State Store access, Draft Store access, quota reservation, or outbound research. This remains true even if deployment flags are accidentally set to enabled/unpaused.

Reason: State Store and Draft Store are separate Durable Objects. A read-then-write control check cannot atomically fence a draft commit against a concurrent emergency Pause. The route must remain disabled until pause/cancellation authority and draft persistence share a same-transaction durable fence, with targeted race and fault-injection tests.

The regression tests assert zero State Store calls, zero draft reads/writes, and zero outbound fetches when the endpoint is invoked. The route does not create drafts, modify the AI Bank, publish articles, or post to social networks. Do not remove this guard to make the feature appear operational.
 
## Emergency pause and in-flight cancellation — source-level evidence (2026-11-21)

- The State Store `/control/pause` transaction atomically sets the durable pause flag, marks every currently running task `cancelled`, clears its lease fields, records `operator_paused`, and appends a per-task audit event. Queued tasks remain queued but cannot be claimed while paused. Repeated Pause is idempotent and also repairs stale running leases left by an earlier runtime version.
- The Worker renews each active read-only review lease every 10 seconds. If the heartbeat is rejected, it aborts the task signal and waits for cooperative cleanup. The signal is checked before each task, before/after source retrieval, and while reading bounded GitHub response streams.
- Late heartbeat and completion calls from the fenced lease are rejected; resuming the runtime does not revive tasks cancelled by Pause.
- A historical source-level run on `093a8d2e98f9b0be4ce8b22be938d8392d6e50e1` passed 260/260 tests, including pause cancellation, late-lease fencing, cooperative abort, and no-subsequent-read checks. This is earlier evidence, not validation of the current PR head. The current exact-head validation run is recorded in PR #358; neither run is a live Cloudflare Preview E2E.
- This is cooperative cancellation for the current read-only executor only. It is not proof that an already-accepted external side effect can be undone, and no side-effecting/publishing handler may be connected without a separate pre-side-effect cancellation fence and fault-injection tests. The Agent Runtime Worker/DO are still not deployed; live Preview OIDC and kill-switch E2E remain release gates.

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
- Durable Object recovery alarms are not cost-free: each \`setAlarm()\` is one SQLite row write and each alarm invocation is one Durable Object request. The Preview config currently declares no Cron Trigger, so there are no recurring Worker invocations from this runtime configuration. If a 30-minute schedule is proposed later, its 48 Worker invocations/day and associated lease-heartbeat/recovery alarm request and SQL-row envelope must be recalculated against verified Free-plan headroom before adding the trigger. The base Workers and Durable Objects Free-tier labels are verified from owner-supplied Billing pages. Actual request/SQL-row/GB-second/storage headroom, Workers AI model entitlement/Neurons usage, and task-review CPU remain unverified.
- An operator-authenticated `POST /internal/enqueue` endpoint now admits one to five validated tasks into the durable queue without executing them. Admission is idempotent and subject to the existing State Store daily/in-flight caps. `POST /internal/dispatch` separately drains at most five already-queued tasks through read-only review handlers.
- A bounded operator queue-dispatch endpoint (`POST /internal/dispatch`) and atomic State Store `/claim-next` operation exist. They require operator authentication and the runtime/durable pause gates, accept a maximum batch of five, claim only the oldest due queued task with lease fencing, and run the existing read-only review handlers. The new `scheduled()` handler reuses this route with a fixed one-task maximum and exact 30-minute cron check; it remains unreachable automatically because no Cron Trigger is configured. Dispatch renews a long-running task lease every 10 seconds and fails closed if renewal fails. If renewal is denied (including after operator Pause), the Worker aborts a cooperative `AbortSignal`; the signal is propagated through the read-only manager, snapshot adapter, and bounded GitHub source reads. It cannot publish or mutate the blog.
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
- This task-handler module is deliberately pure: it does not fetch files, access the State Store, call external services, mutate the catalog, edit articles, publish content, enqueue tasks, or invoke an executor. Snapshot acquisition is handled separately by the read-only adapters described below.
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
- The snapshot adapter itself has no filesystem, network, `fetch`, Worker binding, write, publish, or executor capability. Separately, `src/preview-read-only-sources.mjs` supplies fixed, bounded GET reads from the public GitHub repository's `main` branch for allowlisted article paths and the AI Bank catalog; it accepts no caller-controlled URL or credentials and has no write capability. The Worker wires these readers into the snapshot adapter for operator-triggered read-only reviews. SEO evidence deliberately fails closed because trusted live HTTP-status and broken-link evidence is not implemented. This code path is not deployed to Cloudflare Preview.
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

The dedicated Preview config sets `workers_dev=true` and `preview_urls=true`; if deployed, its workers.dev/Preview URL is publicly reachable unless an access-control layer is added. `/health` exposes only non-sensitive gate state. Operator routes require server-side bearer validation, but the current shared token/static actor label do not provide named-human identity, MFA, or browser-safe sessions. The Preview ingress limiter is approximate and per Cloudflare location, not a strict global cap. Do not put either secret in browser code. A no-cost Access/session boundary and the actual account Free-plan/usage headroom must be verified before deployment. The separate Preview config remains undeployed until those gates pass.


## GitHub Actions OIDC emergency-pause bridge (code-only)

The Worker now has a separate `POST /internal/oidc/pause` route. It accepts only a short-lived GitHub Actions JWT, verifies it against signing keys obtained from GitHub's fixed issuer discovery/JWKS endpoints, pins the expected repository/owner IDs, main ref, exact workflow ref, custom audience, `workflow_dispatch` event, and a configured actor ID, then atomically consumes the token `jti` in the State Store before recording a durable Pause action. It does not accept the shared operator bearer, does not expose Resume, and does not enqueue or execute tasks.

The dedicated Preview config sets `AGENT_OIDC_ENABLED=true` only to exercise the narrowly scoped emergency-pause bridge. Autonomous execution remains disabled (`AGENT_ENABLED=false`, `AGENT_PAUSED=true`); scheduler, recovery alarm, reviewer authentication, and publication remain disabled. The config pins the exact repository/owner IDs, main ref, exact workflow ref, custom audience, and actor ID `342528485`. The manual workflow `.github/workflows/agent-runtime-operator.yml` requests `id-token: write` only for a manually dispatched Pause operation. Its non-secret repository variable `AGENT_RUNTIME_PREVIEW_URL` is configured to the dedicated Preview workers.dev hostname. The workflow cannot Resume, enqueue, execute, publish, or change Production. No OIDC token or Cloudflare secret is committed.

The repository was created on 2026-10-17. GitHub's current documentation says repositories created after 2026-07-15 use immutable default OIDC subjects containing owner and repository IDs; the verifier's expected subject is pinned to that immutable format. This is verified against GitHub's OIDC reference, but the actual workflow token has not yet been obtained or tested against a live Worker.

This is a code-level emergency-pause path only. It is not human MFA, it cannot resume the runtime, and it does not establish that the Preview Worker is deployed. Keep it disabled until the Preview URL, measured Free-tier headroom, and dedicated Preview access boundary are verified.


### Operator response minimization

Read-only review results returned by `/run` and `/internal/dispatch` are explicitly allowlisted. Failed or malformed result objects return only the fixed `read_only_review_failed` error code; raw adapter/internal error strings and unrecognized fields are not reflected in the operator response.

### Research-to-draft evidence preparation boundary

- `prepareDraftEvidenceLedger({ draftStore, artifactId, fetchImpl })` reads only exact source URLs already present in the stored human-authored draft manifest.
- The caller must supply a budget-enforcing fetch implementation; there is no unbudgeted network fallback. Preparation is capped at four unique sources and refuses partial persistence.
- A complete evidence ledger is persisted against the exact draft version read before retrieval. Stale-version conflicts remain blocked and visible.
- Retrieved excerpts remain `source_retrieved_not_fact_checked`; this helper does not create claims, assess semantic support, authorize owner release, publish content, or post to social networks.
- This is an internal helper only. It is not wired to a public endpoint, scheduled invocation, or content-draft executor.

### Human article-authoring brief boundary

- `buildArticleAuthoringBrief({ topic, researchEvidence })` creates a Vietnamese editorial scaffold only when at least three distinct source URLs pass the fixed publisher-label/host/path policy and carry successful retrieval metadata.
- It does not copy source excerpts into article prose, generate factual claims, or create a stored draft. Every article section remains an explicit human-authoring placeholder.
- The deterministic article quality gate is run against the scaffold and is expected to return `needs_revision`; this is intentional and is not a publication-ready article.
- The helper is not registered as a `content_draft` task executor and does not change task queue executability. No automatic article generation is claimed.


### Authenticated AI Bank reviewer API and evidence intake

- `GET /api/reviewer/ai-bank/candidates` returns at most 20 candidate summaries; an optional `limit` must be a single integer from 1 through 20.
- `GET /api/reviewer/ai-bank/candidates/{owner}/{repo}` returns the review packet for the exact `github:owner/repository` candidate.
- `POST /api/reviewer/ai-bank/candidates/{owner}/{repo}/evidence` accepts one evidence record for one of six checks: `official_product_domain`, `pricing_and_free_limits`, `license_scope`, `privacy_and_data_handling`, `platform_support`, or `regional_availability`.
- All routes require same-origin request checks and a signed Google reviewer session. Evidence submission additionally requires the separate evidence-writer email allowlist. The JSON request body is limited to 16 KiB. Reviewer authentication and evidence-writer access remain disabled by default in Preview; the evidence route returns `503` while authentication is unconfigured.
- The evidence request has exactly three top-level fields: `audit_event_id` (UUID), `reviewed_release_identity`, and `evidence`. The evidence object has exactly `check_type`, `source_title`, `source_url`, and `excerpt`; title and excerpt are bounded, and the source URL must be a safe HTTPS URL.
- `reviewed_release_identity` must be the exact canonical JSON serialization of a two-element array containing the candidate's current release URL and its canonical ISO-8601 UTC `published_at` timestamp, for example `JSON.stringify([release.source_url, release.published_at])`. A plain release URL, non-canonical serialization, or identity for an older release is rejected; a stale release returns `409`.
- Evidence submission records a pending, unverified evidence item and an audit event. It does not verify or certify the evidence, change candidate/catalog status, write the public AI Bank catalog, or publish content. Responses keep verification, catalog writes, and public publication unauthorized.
- The reviewer console renders candidate IDs and packet data as text nodes; it does not interpret untrusted candidate content as HTML.
- These routes do not enable reviewer OAuth, configure credentials, deploy the Preview Worker, or authorize AI Bank changes or public publication.


### Free GitHub Actions AI Bank discovery report

- `.github/workflows/ai-bank-readonly-discovery.yml` runs weekly on GitHub-hosted runners and supports manual dispatch with a 1–90 day lookback.
- It calls the shared `discoverAiBankReleaseSignals` implementation; it does not maintain a second feed allowlist or parser.
- The workflow has `contents: read` only, checks the ten fixed public GitHub Atom feeds, and stores a bounded report as a 30-day workflow artifact.
- It does not write AI Bank catalog records, article files, Worker state, D1, DNS, or Production configuration. It uses no secrets and makes no paid API/provider calls.
- The schedule exists in this Preview PR branch only; GitHub scheduled workflows run from the default branch after an approved merge. No schedule is active from this PR branch alone.


### Authenticated read-only runtime operations

- `GET /internal/metrics` requires the operator bearer and returns bounded aggregate task counts, queue ages, internal admission quota pressure, circuit-breaker state, and up to 20 audit-event aggregates from the last 24 hours. It rejects query parameters and never returns task IDs, payloads, or provider/account quota claims.
- `GET /internal/dead-letter` requires the operator bearer and returns at most 50 failed-task metadata records, ordered newest first. Cursor pagination uses the pair `beforeTerminalAt` and `beforeTaskId`; both must be supplied together. Payloads, idempotency keys, lease owners, and other private task fields are never returned.
- Failure classification is advisory and uses a fixed allowlist of error codes. Unknown codes produce low-confidence manual review; classification never changes retries, task state, admission, or circuit-breaker behavior.
- Quota-pressure labels describe only the Agent Runtime's own daily admission and concurrent-task limits: normal, warning (80%), critical (90%), and exhausted (100%). They are not measurements of Cloudflare or external provider quotas.
- State Store retention work is bounded per invocation and oldest-first: up to 100 task/control/rate-limit/daily-usage/budget rows and up to 250 audit events. Repeated reservations drain larger backlogs over multiple turns.
- These endpoints are read-only. They do not enable scheduled execution, external providers, task retries, or publication.
