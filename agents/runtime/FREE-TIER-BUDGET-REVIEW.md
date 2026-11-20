# Agent Runtime — Free-tier budget review

Date: 2026-11-19
Scope: isolated Preview Agent Runtime only
Decision: **budget model is acceptable for a low-volume Preview pilot, subject to live account-usage verification; this is not deployment approval.**

## Official published Cloudflare limits

Cloudflare's current documentation states that SQLite-backed Durable Objects are available on Workers Free. Published Free allowances include:

- 100,000 Durable Object requests per day.
- 13,000 GB-seconds of Durable Object duration per day.
- 5,000,000 SQL rows read per day.
- 100,000 SQL rows written per day.
- 5 GB total SQLite-backed Durable Object storage per account.
- Daily Free allowances reset at 00:00 UTC.
- Exceeding a Free allowance causes further operations of that type to fail; it does not authorize paid overage.

Sources:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/

These are published platform limits, not a measurement of this account's remaining quota. Verify the account's actual plan, usage and billing settings before any live binding or deployment.

## Estimated SQL row writes per task

The current implementation's normal successful lifecycle has this estimated write count before heartbeats:

| Operation | SQL row writes |
|---|---:|
| Reserve: insert task | 1 |
| Reserve: insert/update daily usage | 1 |
| Reserve: insert audit event | 1 |
| queued -> running: update task + audit | 2 |
| running -> terminal: update task + audit | 2 |
| **Total for a fully processed task, excluding heartbeats** | **7** |
| Each lease heartbeat: task update + audit event | 2 |

Each heartbeat adds two row writes (one task update and one audit event). The lease has a 30-minute absolute lifetime and a five-minute initial lease, so the exact heartbeat count depends on the worker cadence and runtime duration; do not assume zero heartbeats.

At the current pilot ceiling of 100 accepted tasks/day:
- Base task-lifecycle writes, excluding heartbeats: up to approximately 700 rows/day.
- If each task records five heartbeats, add up to approximately 1,000 row writes/day.
- At steady-state retention, 100 tasks/day with five heartbeats per task can additionally require approximately 100 terminal-task deletes, 800 audit-row deletes (three lifecycle events plus five heartbeat events per task) and one old daily-usage delete/day, assuming all tasks reach terminal state and the workload is sustained.
- Illustrative pilot estimate with five heartbeats/task: approximately 2,601 row writes/day including retention deletes (700 base lifecycle writes + 1,000 heartbeat writes + 100 task deletes + 800 audit deletes + one daily-usage delete); this excludes expiry-recovery events and is not a measured value.
- Each expiry recovery adds one task update and one audit row (two row writes). At higher volume, include actual retry and recovery rates rather than assuming a single attempt.
- This remains a planning estimate, not evidence of account quota headroom.

This is a reasoned estimate from the current SQL statements, not a measured Cloudflare usage report. Deletes count as writes. Re-run the estimate whenever the schema, audit frequency, transition model or retention policy changes.

## Request and storage considerations

- A task normally causes three Durable Object fetches for reserve, claim and terminal completion: approximately 300 DO requests/day at the current 100 accepted tasks/day pilot ceiling, excluding inspection, usage checks, expiry recovery and any future scheduler traffic.
- A single global Durable Object serializes admission and is intentionally low-throughput. Do not shard it without a separately reviewed global quota and idempotency design.
- Retention targets are 30 days for terminal task rows and 90 days for audit and daily-usage rows. Non-terminal tasks are not removed by terminal-task retention; concurrency limits and future stale-task recovery must prevent indefinite accumulation.
- SQLite storage, index overhead, CPU/duration and real request volume require measurement in an isolated Preview deployment before any claim that the account remains within Free limits.

## Required operational guardrails

1. Keep `AGENT_ENABLED=false` and `AGENT_PAUSED=true`.
2. Keep the current shell configuration unchanged; do not add a DO binding as part of this budget review.
3. Before a separate Runtime Preview binding, verify Workers Free plan and actual account usage in Cloudflare dashboard; confirm no paid plan, payment method, spending limit or billing change is being introduced.
4. Start with a much smaller pilot cap (for example, 100 tasks/day) and increase only after measured request, SQL-row, duration and storage usage remain comfortably below Free limits. This pilot cap is a recommendation, not an applied configuration change.
5. Pause admissions on quota errors or unavailable metrics; never fall back to in-memory counters or bypass provider limits.
6. Add alerting/usage sampling and a documented manual pause path before enabling task execution.
7. No automatic paid upgrade, paid API, paid fallback or billing setup is permitted.

## Decision and remaining gates

The arithmetic suggests that the current 100-task/day pilot design is below the published SQL-row and request ceilings under the stated lifecycle assumptions. It does **not** prove real account headroom, CPU/duration safety, 5 GB storage sufficiency, continuous availability or 24/7 execution.

Before adding a Durable Object binding or deploying this Runtime Preview:
- independently review this estimate and the implementation;
- measure actual usage with a small, isolated, disabled-by-default Preview pilot;
- confirm the account's Free plan and no-billing-change condition;
- complete stale-task recovery, execution idempotency, kill-switch, monitoring and rollback reviews.

No Production Worker, DNS, D1, live user data, secret, schedule or paid setting is changed or authorized by this document.


## Read-only account verification (2026-11-19)

A read-only Cloudflare API inspection was performed for the connected account:

- Workers account settings were readable; the account reports the `standard` Workers usage model. This field alone does **not** prove that the account is on Workers Free or Paid.
- The Durable Objects namespace listing returned an empty result at the time of inspection. No existing namespace was found to reuse for this Agent Runtime.
- The account's Worker script listing showed the existing website and other Preview scripts; no Agent Runtime Durable Object namespace was present.
- Billing profile and billing usage endpoints returned HTTP 403 because the connected OAuth authorization does not include the required Billing Read scope. Actual plan, billing state, current usage, and remaining quota therefore remain **unverified**.
- No namespace was created, no binding or secret was added, no deployment was attempted, and no account configuration was changed.

### Decision

**Do not create a Durable Object namespace or deploy the Agent Runtime yet.** Published Free-tier limits are not a substitute for confirming this account's actual plan and usage. The next safe prerequisite is a read-only verification of the account's Workers plan and Durable Objects usage through an authorized billing-read view (or the Cloudflare dashboard). If the plan/usage cannot be verified as Free with sufficient headroom, keep the runtime unbound and disabled; do not upgrade or enable billing.


## Read-only Preview prerequisite recheck (2026-11-20)

A second read-only Cloudflare API check confirmed:

- The account's Durable Objects namespace list is still empty.
- The Worker script list contains the existing website/Preview scripts but no `ai-thuc-chien-agent-runtime-preview` script.
- No namespace was created, no Worker was deployed, and no secret or account setting was changed.
- The prior Billing Read permission gap remains unresolved; the actual Workers plan, billing state, and remaining usage headroom are still unverified.

**Decision unchanged:** keep `wrangler.preview.jsonc` as code-only. Do not create a namespace, inject secrets, or deploy until a read-only Free-plan/usage verification is available. Do not upgrade or enable billing to clear this gate.


## OIDC pause path — additional resource/security notes (2026-11-20)

- GitHub OIDC verification performs two fixed-host HTTPS GETs (issuer discovery and JWKS) per accepted token; no custom URL, redirect, or caller credential is allowed. This adds no paid AI provider dependency, but request latency and Worker CPU must be measured in Preview before operational use.
- A successful token consumes one State Store replay-ledger write and one durable Pause control mutation/audit write. Invalid tokens should fail before State Store access; replayed tokens return conflict without a second Pause.
- The manual workflow is disabled from operational use until the Preview URL repository variable and Preview deployment are confirmed. The actor allowlist is pinned to `342528485`, observed as the triggering actor in GitHub Actions run #317. The Worker config feature flag remains false.
- This is not evidence of Cloudflare Free-tier entitlement. Namespace, Worker, secret, and deploy steps remain blocked until Billing Read or equivalent authoritative usage evidence is available. No paid upgrade or billing activation is permitted.
