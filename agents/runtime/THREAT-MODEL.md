# Agent Runtime — threat model and pre-binding security checklist

Date: 2026-11-19  
Scope: `agents/runtime/` isolated Preview shell and proposed Worker → SQLite Durable Object path  
Status: engineering threat-model draft; **not an independent security sign-off and not deployment approval**

## 1. Security objective

Keep the Agent Runtime disabled and unreachable until its operator boundary, internal state-store boundary, execution model, recovery behavior, monitoring, and cost controls have been independently reviewed. A compromise of an untrusted request, task payload, or operator credential must not expose the State Store, execute arbitrary work, disclose secrets, or affect the public website.

## 2. Assets and trust boundaries

| Asset | Security property | Current location / exposure |
|---|---|---|
| Production website Worker, DNS, D1 and live content | Integrity and availability | Out of scope; must remain unchanged |
| Operator credential | Confidentiality and authorized use | Source verifier exists; no Preview secret configured |
| Internal State Store credential | Confidentiality and service-to-service authentication | Source verifier/client exist; no Preview secret configured |
| Task payload and idempotency key | Integrity, confidentiality, bounded retention | SQLite DO implementation; namespace not bound |
| Daily quota and in-flight count | Integrity / abuse resistance | Atomic SQLite transaction; not deployed |
| Audit metadata | Integrity and non-disclosure | SQLite implementation; not deployed |
| Kill switch | Ability to stop admission and dispatch | Fail-closed flags exist; operational control not yet implemented |
| External publishing credentials / social accounts | Confidentiality and constrained side effects | Not connected to Agent Runtime |

Trust boundaries:
1. Public internet → Worker ingress.
2. Worker ingress → operator authentication and task validation.
3. Worker → internal State Store client → Durable Object namespace.
4. Agent executor → external APIs / publishing targets (future; not implemented).
5. Preview account resources → production website resources (must remain separate).

## 3. Adversaries and threat scenarios

### T1 — Unauthenticated public caller
**Threat:** call task creation, transitions, inspection, or usage routes directly.  
**Current controls:** Worker exposes `/health`, operator-authenticated `/run`, and operator-authenticated `/internal/*` routes. `/run` and `/internal/dispatch` fail closed while `AGENT_ENABLED` is not `true` or `AGENT_PAUSED` is not `false`. When enabled, the Worker can process only bounded read-only reviews for `content.review`, `ai_bank.candidate_review`, and `seo.audit`; live SEO evidence deliberately fails closed when unavailable. The read-only manager does not publish, mutate repository content, or call an external model provider. State Store calls use a distinct internal bearer token, verified by the Durable Object handler. The Preview config remains undeployed and all outer runtime gates remain closed by default.  
**Residual risk:** `wrangler.preview.jsonc` declares the `AGENT_STATE_STORE` Durable Object binding, SQLite migration, and Preview-only per-IP Rate Limiting binding on this feature branch. The config is undeployed; the Durable Object namespace and secrets are not provisioned. The Rate Limiting namespace ID was checked against the currently deployed Worker script bindings, but has not been deployed or runtime-verified. Cloudflare counters are approximate per location, not a strict global cap. If deployed later, every request path must remain reachable only through the fixed Worker client; never expose the DO stub or a generic proxy.

### T2 — Operator credential compromise
**Threat:** an attacker with the operator token attempts to submit arbitrary task types, payloads, or state transitions.  
**Current controls:** task contract validation, fixed operation allowlist in the internal client, bounded payload/body sizes, and bounded state transitions.  
**Residual risk:** bounded read-only review processing now exists, but there is no mutating task executor or publishing capability. The dedicated Preview config now requires a per-client-IP ingress rate limiter for all routes, including reads. Cloudflare applies approximate counters separately in each location, so this is not a strict global cap and must not be treated as the only abuse-control layer. The service actor label remains shared/static rather than a human identity. Before enabling scheduled processing, complete request replay policy, auditable credential revocation/rotation, and independent review of the operator identity boundary. A shared bearer token must never be placed in browser JavaScript.

### T3 — Internal token leakage or confused-deputy abuse
**Threat:** a caller tricks the Worker into forwarding caller-controlled paths, headers, object IDs, or credentials to the DO.  
**Current controls:** the Worker uses the fixed object identity and internal origin, maps fixed route handlers to State Store paths, constructs fresh requests, and sends only the internal bearer token. It does not forward caller Authorization, cookies, Origin, or arbitrary headers. The internal token is distinct from the operator token. The bridge now includes pause/resume and expired-lease recovery operations in addition to read-only usage/task/control inspection.  
**Residual risk:** the client returns the raw internal `Response`; the future Worker integration must parse and reduce it to an explicit response schema. Never pass through raw DO responses, stack traces, SQL errors, or internal headers. Secret leakage through logs/traces must be tested.

### T4 — State inspection crosses tenant/operator boundaries
**Threat:** one operator reads another operator's task payload, idempotency key, or usage.  
**Current controls:** no multi-tenant access is implemented or claimed.  
**Residual risk:** the current global store and `/task` / `/usage` routes are not tenant-scoped. Before multiple operators, tenants, or public users are supported, add immutable owner/tenant identity to every task and query, enforce authorization in the DO, and add cross-tenant negative tests. Until then, restrict all store access to one trusted operator/service boundary.

### T5 — Test-only controls accidentally enabled
**Threat:** a deployed environment accidentally sets `RUNTIME_TESTING=true`, enabling the test clock override and `/__test/rollback` probe.  
**Current controls:** the deployable `src/state-store.mjs` no longer contains the rollback route, `RUNTIME_TESTING` branch, or `x-test-now` clock override. Those probes now live only in `tests/state-store-test-worker.mjs`, a Miniflare-only test harness that is not the Wrangler entrypoint. A regression test statically checks their absence from deployable source and verifies the production State Store returns 404 for the test route and ignores the test clock header.  
**Residual risk:** future build/config changes could accidentally point Wrangler at a test module. Keep the Wrangler `main` fixed to `src/worker.mjs`, retain the regression assertion, and review any entrypoint change before deployment.

### T6 — Quota bypass, duplicate work, or concurrency race
**Threat:** parallel or replayed requests exceed task/day limits or create duplicate work.  
**Current controls:** SQLite synchronous transaction for idempotency, quota and concurrency reservation; unique idempotency key; fixed pilot caps (100/day, 5 in-flight); bounded transitions.  
**Residual risk:** reservation idempotency does not make future external side effects exactly-once. Every publishing or external API action needs its own idempotency key, durable operation ledger, reconciliation strategy, and retry policy.

### T7 — Resource exhaustion / oversized inputs
**Threat:** large bodies, malformed JSON, unbounded task payloads, or repeated requests consume CPU/storage.  
**Current controls:** streamed body cap before JSON parse, task payload cap, strict schema validation, daily quota and concurrency cap.  
**Residual risk:** State Store mutation routes have a durable per-service-actor rate limit. The Preview Worker additionally requires an approximate per-client-IP ingress limit for all routes; Cloudflare counters are per-location and can temporarily exceed the threshold, so this is not a strict global rate limit. The actor label is shared/static rather than a human identity. No deployed request timeout budget, scheduler backpressure, or measured DO resource usage exists. Do not increase limits based only on arithmetic estimates.

### T8 — Pause/kill switch bypass
**Threat:** queued work starts after pause, or the operator cannot stop active dispatch.  
**Current controls:** State Store persists pause state and rejects reservations, queued→running transitions, and lease recovery when disabled/paused; terminal bookkeeping remains available where explicitly allowed. Worker has authenticated pause/resume control routes. Both outer flags default closed in the dedicated Preview config.  
**Residual risk:** a bounded scheduler path and dispatch gate now exist in source, and the Preview config declares a 30-minute cron. They remain inactive because `AGENT_SCHEDULER_ENABLED=false`, `AGENT_RECOVERY_ALARM_ENABLED=false`, `AGENT_ENABLED=false`, and `AGENT_PAUSED=true`. The GitHub OIDC operator workflow is manual and pause-only; it is not a resume or autonomous recovery authorization. Pause does not forcibly interrupt an in-flight external side effect. A complete kill switch still needs fault-injection evidence covering admission, claims, scheduled dispatch, in-flight work, and any future outbound effects. The shared bearer and static actor label are not a human identity control.

### T9 — External side-effect / publishing abuse
**Threat:** an agent publishes unreviewed, duplicated, copyrighted, misleading, or malicious content to the official website or Facebook.  
**Current controls:** no executor, publishing connector, or social credentials are wired to this runtime.  
**Residual risk:** before any publishing capability, implement content provenance/citation checks, originality review, policy/compliance gates, human-readable audit trail, per-destination allowlists, draft/preview mode, idempotent publishing, rollback/takedown, and separate scoped credentials. User permission to publish quality-approved content does not authorize deploying code or changing production infrastructure.

### T10 — Supply-chain or CI compromise
**Threat:** compromised action/dependency modifies runtime or exfiltrates credentials.  
**Current controls:** validation workflow uses read-only contents permission, pinned action SHAs, no persisted checkout credentials, local pinned test dependencies, no Cloudflare token, and no deploy command.  
**Residual risk:** current npm audit scope is the isolated test dependency tree only, not the full repository or production dependency graph. Add repository-wide dependency/SBOM review before release.

## 4. Current evidence (source-level only)

- While the outer gates are closed, `/run` and `/internal/dispatch` return a fail-closed disabled/paused response. If explicitly enabled, `/run` accepts at most five tasks and `/internal/dispatch` processes at most five operator-requested tasks or one scheduled task per tick; both use the bounded read-only review manager and persist lease/result bookkeeping in the State Store. No mutating or publishing task handler is present.
- `wrangler.preview.jsonc` is a standalone `ai-thuc-chien-agent-runtime-preview` config that declares a SQLite Durable Object binding/migration and a `*/30 * * * *` cron. The outer gates remain `AGENT_ENABLED=false`, `AGENT_SCHEDULER_ENABLED=false`, `AGENT_RECOVERY_ALARM_ENABLED=false`, `AGENT_PAUSED=true`, and `AGENT_OIDC_ENABLED=false`; Preview also requires its per-IP ingress rate limiter. The config has no route, custom domain, D1/KV/R2 binding, queue, or checked-in secret value. It remains undeployed; Durable Object namespace provisioning, secret configuration, and Free-plan headroom have not been verified. The rate-limit namespace ID is not currently bound to any of the inspected deployed Worker scripts; the binding itself remains undeployed.
- State Store routes authenticate with `AGENT_STATE_STORE_TOKEN` before parsing or routing.
- Internal client uses a fixed DO identity and fixed operations, and creates a new request with only the internal token and required content type.
- State Store and client tests cover auth separation, rotation, request bounds, strict query validation, quota/idempotency, transitions, pause behavior, and persistence.
- A read-only Cloudflare inventory previously showed no Agent Runtime Worker script and no DO namespace. This is a point-in-time observation, not proof about future account state.
- Cloudflare API schema search exposes namespace inventory and general analytics/billable-usage endpoints, but no dedicated Durable Objects usage endpoint that would resolve the account's current DO request, SQL-row, GB-second, or storage headroom. Billing Read remains unavailable to this connected session.

## 5. Mandatory gates before a Preview binding or deployment

- [ ] Independent reviewer inspects current source and this threat model; records findings and disposition.
- [x] Remove test-only route/clock override from deployable code; verify the production source has no test hook and the production Durable Object returns 404 for the test route.
- [x] Implement Worker ingress → fixed-operation State Store client integration with operator authorization, bounded request bodies, and no caller credential/header forwarding; keep all task handlers read-only.
- [x] Add a Preview-only per-IP ingress/read-route limiter and negative tests for missing/unavailable limiter bindings; note that Cloudflare limits are approximate per location, not globally strict.
- [ ] Independently verify explicit response allowlisting and negative tests for response leakage and missing/rotated secrets.
- [ ] Add end-to-end negative tests for every unauthenticated route, operator/internal token confusion, arbitrary path/header injection, response leakage, missing binding, missing secret, and rotation.
- [ ] Keep one operator only, or implement tenant ownership and cross-tenant isolation before multi-user access.
- [ ] Obtain verifiable Free-plan usage/headroom and confirm no billing/payment/paid upgrade change; if unavailable, do not bind or deploy.
- [x] Implement bounded read-only task review, idempotent task reservation, lease fencing/heartbeat, and bounded expired-lease recovery paths in source/tests.
- [ ] Before any external write capability, independently review executor safety, per-side-effect idempotency, bounded retries, and reconciliation; no publishing executor is currently implemented.
- [ ] Verify a complete emergency stop with fault-injection tests covering admission, claim, cron scheduling, dispatch, in-flight work, and future outbound effects; the current manual OIDC operator is pause-only.
- [ ] Implement monitoring, redacted logs, alerts, storage/usage sampling, rollback and recovery runbooks.
- [ ] Verify the Preview deployment is isolated from Production Worker, DNS, D1, secrets, and live user data.
- [ ] Re-run only the affected runtime/security/release checks on the exact candidate SHA.
- [ ] Obtain explicit release approval before any production or public exposure.

## 6. Explicit non-claims

This document is not a penetration test, independent audit, compliance certification, deployment approval, or proof of 24/7 operation. No Agent Runtime Worker has been deployed or activated by this work. No Production Worker, DNS, D1, live data, production secret, billing setting, or social account has been changed.


## Preview exposure note (2026-11-20)

`wrangler.preview.jsonc` sets `workers_dev=true` and `preview_urls=true`, so the dedicated Worker is intended to have a public workers.dev/Preview URL if deployed. Public reachability is not access control. `/health` intentionally returns only non-sensitive service/gate state; every operator route must continue to require authentication, and no shared bearer may be placed in browser JavaScript. Before deployment, decide whether to add an already-entitled, no-cost Cloudflare Access boundary or another independently reviewed ingress control. Billing/plan status and remaining quota are not verified, so the separate Preview config must remain undeployed until those checks pass.
