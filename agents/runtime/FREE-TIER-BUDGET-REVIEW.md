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

## Read-only account check (2026-11-19)

A read-only Cloudflare account endpoint, `GET /accounts/{account_id}/observability/usage/limit`, returned:
- `plan: free`
- `status: normal`
- `sample_rate: 1`
- `limit: 200,000 events/day`

Cloudflare's API schema defines this endpoint's `plan` field as `free` when the account has no Workers Paid or Enterprise plan. This is positive evidence that the account is currently on Workers Free. The 200,000/day value is an Observability event/telemetry limit, **not** a measurement of Durable Objects requests, SQL rows, GB-seconds, or remaining account quota.

The read-only `billable-usage/info` endpoint returned HTTP 403 (authentication error), and subscription/billing endpoints require Billing Read, which is not available to the connected session. Therefore actual Durable Objects usage/headroom and billing settings remain unverified. Do not infer them from the Observability endpoint.

## Estimated SQL row writes per task

The current implementation's normal successful lifecycle has this estimated write count:

| Operation | SQL row writes |
|---|---:|
| Reserve: insert task | 1 |
| Reserve: insert/update daily usage | 1 |
| Reserve: insert audit event | 1 |
| queued -> running: update task + audit | 2 |
| running -> terminal: update task + audit | 2 |
| **Total for a fully processed task** | **7** |

At the currently enforced pilot ceiling of 100 accepted tasks/day (and 5 in-flight tasks):
- Normal task-lifecycle writes: up to approximately 700 rows/day.
- At steady-state retention, cleanup can additionally delete up to approximately 100 terminal task rows, 300 audit rows and one old daily-usage row/day, assuming every accepted task reaches both transitions and the workload is sustained.
- Illustrative steady-state upper estimate: approximately 1,101 rows written/day, before schema changes, retries, additional audit events, or unexpected cleanup.
- This is approximately 1.1% of the published 100,000 rows-written/day allowance.

This is a reasoned estimate from the current SQL statements, not a measured Cloudflare usage report. Deletes count as writes. Re-run the estimate whenever the schema, audit frequency, transition model or retention policy changes.

## Request and storage considerations

- A task normally causes three Durable Object fetches for reserve, running transition and terminal transition: approximately 300 DO requests/day at 100 completed tasks/day, excluding inspection, usage checks and future scheduler traffic.
- A single global Durable Object serializes admission and is intentionally low-throughput. Do not shard it without a separately reviewed global quota and idempotency design.
- Retention targets are 30 days for terminal task rows and 90 days for audit and daily-usage rows. Non-terminal tasks are not removed by terminal-task retention; concurrency limits and future stale-task recovery must prevent indefinite accumulation.
- SQLite storage, index overhead, CPU/duration and real request volume require measurement in an isolated Preview deployment before any claim that the account remains within Free limits.

## Required operational guardrails

1. Keep `AGENT_ENABLED=false` and `AGENT_PAUSED=true`.
2. Keep the current shell configuration unchanged; do not add a DO binding as part of this budget review.
3. Before a separate Runtime Preview binding, verify Workers Free plan and actual account usage in Cloudflare dashboard; confirm no paid plan, payment method, spending limit or billing change is being introduced.
4. Keep the enforced pilot cap at 100 tasks/day and 5 in-flight tasks; do not increase it until measured request, SQL-row, duration and storage usage remain comfortably below Free limits.
5. Pause admissions on quota errors or unavailable metrics; never fall back to in-memory counters or bypass provider limits.
6. Add alerting/usage sampling and a documented manual pause path before enabling task execution.
7. No automatic paid upgrade, paid API, paid fallback or billing setup is permitted.

## Decision and remaining gates

The arithmetic suggests that the currently enforced 100-task/day pilot is below the published SQL-row and request ceilings under the stated lifecycle assumptions. It does **not** prove real account headroom, CPU/duration safety, 5 GB storage sufficiency, continuous availability or 24/7 execution.

Before adding a Durable Object binding or deploying this Runtime Preview:
- independently review this estimate and the implementation;
- measure actual usage with a small, isolated, disabled-by-default Preview pilot;
- confirm the account's Free plan and no-billing-change condition;
- complete stale-task recovery, execution idempotency, kill-switch, monitoring and rollback reviews.

No Production Worker, DNS, D1, live user data, secret, schedule or paid setting is changed or authorized by this document.


## Live Cloudflare account snapshot (2026-11-20)

A read-only check through the connected Cloudflare account API confirmed:

- `GET /accounts/{account_id}/observability/usage/limit` returned `plan: free`, `status: normal`, `sample_rate: 1`, and an Observability ingestion limit of 200,000 events/day. This is an Observability telemetry limit; it is **not** a measurement of Worker requests, Durable Object requests, SQL rows, duration, or remaining quota.
- The account Worker inventory returned 12 Worker scripts. The schedules endpoint showed two configured Cron schedules (`17 * * * *` on `ai-thuc-chien-blog` and `ai-thuc-chien-blog-auth-app-preview`); the other ten listed scripts had no schedules. Cloudflare's published Workers Free allowance is five Cron Triggers per account, so the inventory currently shows two configured schedules against that published ceiling.
- The Durable Object namespace inventory returned an empty list. No Durable Object namespace is currently present in the account, and no `ai-thuc-chien-agent-runtime-preview` Worker appears in the Worker script inventory. The Agent Runtime has therefore **not** been deployed or bound to a Durable Object.
- A read-only request to the account billing-usage endpoint returned HTTP 403 because the connected OAuth session does not include the `Billing Read` permission. The account's payment method, subscription/billing state, and billable usage could not be independently inspected. Do not interpret the `plan: free` Observability field as proof that no payment method or other paid Cloudflare product exists. No billing or payment settings were changed.

The account snapshot is a point-in-time inventory, not a remaining-quota measurement. Before any Durable Object binding or runtime deployment, re-check live usage and confirm the no-billing-change requirement.
