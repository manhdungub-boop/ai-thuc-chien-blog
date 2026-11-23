# Agent Runtime Preview — live deployment status (2026-11-23)

**Decision:** The dedicated Agent Runtime Preview Worker is deployed and bound to isolated SQLite Durable Objects, but it is **not activated** for task execution, recurring scheduling, reviewer sign-in, AI inference, content writes, article publishing, or social publishing. This document is a read-only state record, not an independent security sign-off or Production release approval.

## Repository and PR state — refreshed 2026-11-23

- Repository: `manhdungub-boop/ai-thuc-chien-blog` only.
- `main` HEAD: `00bf4c6848657d322e1e54d3b6957ccbe25a9fb8`.
- [PR #327](https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/327) remains **open / Draft / unmerged**; base `main`, head branch `integration/agent-runtime-v5-preview-20261120`, exact head before this documentation refresh `bfecade5101fc8e0f6b7a90adfae87a7a104e159`. GitHub reported 207 commits ahead, 0 behind, and mergeable.
- [PR #358](https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/358) is **closed / merged into the PR #327 integration branch**, via squash commit `86c02181ec86d972741e181844f11e8a7c004635` at 2026-11-23 00:55:42 UTC. It is not an open child PR.
- The current PR #327 branch was two commits beyond that squash commit before this documentation refresh. Do not use the stale PR descriptions or earlier deployment-status notes as current branch state.

## Dedicated Preview deployment — read-only Cloudflare evidence

- Worker: `ai-thuc-chien-agent-runtime-preview`.
- Current Cloudflare version: `f26e7871-23fa-4627-9a4e-72e36c882b27`.
- Deployment: `6b252e59-e881-43e0-b589-b2e335020a46`, created 2026-11-22 23:44:24 UTC; 100% of this dedicated Worker’s traffic is assigned to that version.
- The deployment workflow run [45084521376](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45084521376) used candidate commit `8a470ad5dd1f59e96aff9ec37bf85697e79e1dcb` from branch `reconcile/agent-runtime-pr339-schema-v7-20261121`; validation and deploy jobs succeeded.
- The deployed commit is **not the current PR #327 head**. The current integration branch contains the later squash integration and follow-up commits. Therefore the live deployment is not exact-current-head Preview evidence. No redeployment was performed by this documentation update.
- `workers.dev` is enabled and `preview_urls` is disabled. The hostname is public. No custom domain, Production route, D1, KV, R2, service binding, or queue consumer is configured.
- Four SQLite-backed Durable Object namespaces are bound: `AgentStateStore`, `AgentReviewerAuthStore`, `AgentDraftStore`, and `AgentAIBankCandidateStore`.
- The Rate Limiting binding is configured at 60 requests per 60 seconds per Cloudflare location. This is approximate and location-scoped, not a strict global cap.
- Secret binding name `AGENT_STATE_STORE_TOKEN` is present. Its value was not read. No shared-bearer `AGENT_OPERATOR_TOKEN` or `AGENT_OPERATOR_ID` is configured.
- Cloudflare Access is not enabled for the account; the Access application-list API returned `access.api.error.not_enabled`. Public `/health` and static UI assets must disclose only non-sensitive state. Privileged routes must retain their independent authentication gates.

## Live fail-closed flags

| Flag | Live value | Meaning |
|---|---:|---|
| `AGENT_ENABLED` | `false` | Task execution disabled |
| `AGENT_PAUSED` | `true` | Durable pause asserted |
| `AGENT_SCHEDULER_ENABLED` | `false` | No scheduler |
| `AGENT_RECOVERY_ALARM_ENABLED` | `false` | No recovery alarm |
| `AGENT_REVIEWER_AUTH_ENABLED` | `false` | Reviewer sign-in disabled |
| `AGENT_OIDC_ENABLED` | `true` | Pause-only GitHub OIDC control path |

The Worker has a `scheduled` handler in its bundle, but the live Cron schedule list is empty. OIDC is enabled only for the manual, main-ref Pause path; it does not enable Resume, enqueue, task execution, AI inference, content writes, publication, or Production operations.

Live OIDC Pause E2E run [45085028521](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45085028521) completed successfully on `main` and reported matching pinned GitHub OIDC claims plus persisted Preview pause. This is Pause-only evidence, not execution or full Runtime E2E evidence.

## Exact-current-head CI evidence before this documentation refresh

For PR #327 head `bfecade5101fc8e0f6b7a90adfae87a7a104e159`, the following PR-triggered runs completed successfully:

- [Verify Website Health #45095592049](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45095592049)
- [Static CI Quality Gate #45095592198](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45095592198)
- [Editorial Release Readiness #45095592090](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45095592090)
- [Agent Runtime Preview Shell Validation #45095592068](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45095592068): validation, isolated Worker contract tests, Wrangler types/bundle dry-run, Preview isolation, disabled scheduler and pause-only OIDC workflow assertions all passed; no deployment was performed.
- [CodeQL Offline Security Analysis #45095592073](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45095592073): JavaScript/TypeScript, Python and GitHub Actions jobs passed, including the high-severity gate. SARIF was not uploaded.

The three historical CodeQL double-unescaping review threads (#13–#15) are marked resolved/outdated by GitHub Advanced Security. That does not replace a fresh independent review of the current PR head.

## Review state

- The last `daingo11` APPROVED review on PR #327 was attached to older commit `64513d95efd2f42fcf2e695cc13dbad448533011` at 2026-11-21 12:37:25 UTC.
- That review was later **DISMISSED** on the same older commit at 2026-11-22 14:57:02 UTC.
- No APPROVED review is recorded on current head `bfecade5101fc8e0f6b7a90adfae87a7a104e159`.
- `daingo11` is a second account owned by the repository owner; its approval is not an independent third-party security review.
- The latest Codex review attempt on PR #358 could not complete because the connected Codex review quota was exhausted. Do not treat the failed review attempt as a pass or repeatedly retry it.

## Free-tier and quota evidence

- Preview deployment run [45084521376](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45084521376) passed its Free-plan guard after explicit workflow confirmation and no active Workers subscription row was returned.
- Owner-provided Billing evidence records Workers Free and Durable Objects Free, no payment method, and no invoices.
- The connected Cloudflare API still does not provide Billing Read. Do not infer remaining request, CPU, Durable Object request, SQLite row, GB-second, or storage headroom from the Free plan label.
- Cloudflare Observability currently reports `plan: free` and a 200,000-events/day observability limit. This is not a Workers or Durable Objects usage meter.
- Workers Builds build-minute availability is not exhausted and refreshes 2026-11-30. This is not Runtime quota headroom.

## Remaining release gates

1. Obtain an independent third-party security review on the exact current PR #327 head after this documentation commit; re-review any later code changes.
2. Establish a safe, exact-current-head Preview deployment path. The existing PR-branch deploy workflow only permits the older reconciliation branch or `main`; the separate manual workflow is `main`-only. Do not dispatch either workflow until the branch/ref, environment reviewer, Free-plan guard, and exact source are verified.
3. Reconcile the public `workers.dev` exposure with the absence of Cloudflare Access. Keep privileged endpoints authenticated and verify positive/negative route behavior on the exact current Preview.
4. Measure actual Workers request/CPU and Durable Objects request/SQLite/storage/duration usage. Do not treat the plan label, Observability events, or published Free limits as headroom.
5. Complete exact-head Preview E2E and fault-injection for OIDC claim binding, token replay, emergency Pause, in-flight cancellation, lease fencing, bounded ingress, rate-limit failure, quota failure, recovery and rollback.
6. Keep task execution, reviewer sign-in, scheduler, recovery alarms, AI inference, content writes, public publishing and social publishing disabled until every preceding gate is satisfied.
7. The Production Worker `ai-thuc-chien-blog` has an active Cloudflare Workers Builds trigger for this GitHub repository on branch `main`, path `*`, with deploy command `npx wrangler deploy`. A merge/push to `main` can therefore deploy Production automatically. Keep this PR Draft and do not merge.

No Production Worker, DNS, D1, Production secrets, OAuth, routes, traffic, billing settings, live user/member data, public article, AI Bank catalog, or Facebook account was changed by this documentation update. No Runtime deployment, migration, scheduler activation, or autonomous task execution was performed.
