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
- At steady-state retention, cleanup can additionally delete up to approximately 1,000 terminal task rows, 3,000 audit rows and one old daily-usage row/day, assuming every accepted task reaches both transitions and the workload is sustained.
- Illustrative pilot estimate with five heartbeats/task: approximately 2,101 rows/day including the earlier retention estimate scaled to 100 tasks/day; this is not a measured value.
- At 1,000 tasks/day, five heartbeats/task would add approximately 10,000 writes/day above the earlier lifecycle estimate, before retention deletes.
- This remains a planning estimate, not evidence of account quota headroom.

This is a reasoned estimate from the current SQL statements, not a measured Cloudflare usage report. Deletes count as writes. Re-run the estimate whenever the schema, audit frequency, transition model or retention policy changes.

## Request and storage considerations

- A task normally causes three Durable Object fetches for reserve, running transition and terminal transition: approximately 3,000 DO requests/day at 1,000 completed tasks/day, excluding inspection, usage checks and future scheduler traffic.
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

The arithmetic suggests that the current 1,000-task/day design is below the published SQL-row and request ceilings under the stated lifecycle assumptions. It does **not** prove real account headroom, CPU/duration safety, 5 GB storage sufficiency, continuous availability or 24/7 execution.

Before adding a Durable Object binding or deploying this Runtime Preview:
- independently review this estimate and the implementation;
- measure actual usage with a small, isolated, disabled-by-default Preview pilot;
- confirm the account's Free plan and no-billing-change condition;
- complete stale-task recovery, execution idempotency, kill-switch, monitoring and rollback reviews.

No Production Worker, DNS, D1, live user data, secret, schedule or paid setting is changed or authorized by this document.
