# Agent Runtime Preview — live deployment status (2026-11-23)

**Decision:** The isolated Agent Runtime Preview shell is deployed. It is **not activated** for autonomous task execution, scheduling, reviewer sign-in, AI inference, content writes, article publishing, or social publishing. This is not an independent security sign-off or Production release approval.

## Deployed Preview resources

- Dedicated Worker: `ai-thuc-chien-agent-runtime-preview`.
- Latest verified Cloudflare version: `f26e7871-23fa-4627-9a4e-72e36c882b27`.
- Deployment ID: `6b252e59-e881-43e0-b589-b2e335020a46` (2026-11-22 23:44:24 UTC); version receives 100% of this dedicated Preview script's traffic.
- Worker config: `workers_dev=true`, `preview_urls=false`; no Cron Trigger, custom domain, Production route, D1, KV, R2, service binding, or queue consumer.
- Four SQLite-backed Durable Object namespaces are bound: `AgentStateStore`, `AgentReviewerAuthStore`, `AgentDraftStore`, and `AgentAIBankCandidateStore`.
- Cloudflare Workers Rate Limiting binding is present at 60 requests per 60 seconds per Cloudflare location. This is approximate and location-scoped, not a strict global cap.
- Preview secret `AGENT_STATE_STORE_TOKEN` is present. Its value was not read. No `AGENT_OPERATOR_TOKEN` or `AGENT_OPERATOR_ID` is configured, so the shared-bearer operator control routes are not enabled.

## Fail-closed runtime flags

| Flag | Live Preview value | Meaning |
|---|---:|---|
| `AGENT_ENABLED` | `false` | Task execution disabled |
| `AGENT_PAUSED` | `true` | Durable pause remains asserted |
| `AGENT_SCHEDULER_ENABLED` | `false` | No scheduler |
| `AGENT_RECOVERY_ALARM_ENABLED` | `false` | No recovery alarm |
| `AGENT_REVIEWER_AUTH_ENABLED` | `false` | Reviewer sign-in disabled |
| `AGENT_OIDC_ENABLED` | `true` | Manual, main-ref, pause-only OIDC control path |

The OIDC workflow is `workflow_dispatch` only on `main`, grants only `id-token: write`, and pins repository ID, owner ID, immutable subject, exact workflow ref, event, audience, and actor ID. It has no Resume, enqueue, execution, publishing, or Production operation.

**Live OIDC Pause E2E passed:** GitHub Actions run [45085028521](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45085028521) reported that the pinned GitHub OIDC claims matched and that the Preview Worker confirmed persisted pause. The job log did not expose the token or secret values.

## Deployment and environment controls

- Preview deploy run [45084521376](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45084521376) completed successfully for candidate commit `8a470ad5dd1f59e96aff9ec37bf85697e79e1dcb`; both validation and deploy jobs passed.
- GitHub Environment `agent-runtime-preview` has required reviewer `daingo11`, `prevent_self_review=true`, and `can_admins_bypass=false`. The secret name `CLOUDFLARE_AGENT_PREVIEW_API_TOKEN` is present; its value was not read. The deployment review history records approval by `daingo11`.
- The deployment workflow's Free-plan guard passed with explicit Free-plan confirmation and no active Workers subscription record detected. Owner-supplied Billing evidence identifies Workers Free and Durable Objects Free, with no payment method or invoices. These are base plan-label checks, not a measurement of remaining service-level quota.
- Cloudflare build limits were not exhausted at the time of inspection. Observability reported 12 events for 2026-11-22; this is not a Workers request, CPU, Durable Object, SQLite row, GB-second, or storage usage measurement.

## Remaining cost and release gates

Actual account-wide remaining Workers requests/CPU, Durable Object requests, SQLite row reads/writes, GB-seconds, storage, and per-invocation CPU headroom are **not yet authoritatively measured**. Do not treat the 12 observability events or published Free-tier limits as quota headroom. Do not add Cron or increase workload until those metrics are measured against the Free limits.

The `workers.dev` hostname is publicly reachable. `/health` is intended to disclose only non-sensitive gate state; privileged OIDC pause requires a verified short-lived GitHub token. No Cloudflare Access boundary is configured in this Worker deployment. Keep secrets out of browser code and logs.

No Production Worker, DNS, D1, production secret, live user data, billing setting, AI provider, public article, AI Bank catalog, or Facebook account was changed by this Preview deployment. No autonomous work is running.

## Stacked pull-request state

- [PR #327](https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/327): parent integration branch synchronized with `main`; current head `64513d95efd2f42fcf2e695cc13dbad448533011`; 15 exact-head checks passed; current head has `daingo11` approval; GitHub reports mergeable state `clean`.
- [PR #358](https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/358): child reconciliation branch synchronized with the parent and the OIDC/feed/sitemap conflicts were resolved; current head `6b336b17dc961f91703c6c394550cc15e7370646`; fresh independent review by `daingo11` is requested. Merge remains blocked until exact-head checks complete and the fresh review is recorded.

This file supersedes older statements in `README.md`, `THREAT-MODEL.md`, and `FREE-TIER-BUDGET-REVIEW.md` that claim the Preview Worker is not deployed, namespaces/secrets are absent, OIDC is disabled, or `preview_urls=true`. Those statements describe earlier point-in-time states. The independent security review and all activation gates remain mandatory.
