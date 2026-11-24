# Agent Runtime Preview — live deployment status (2026-11-24)

**Decision:** The Agent Runtime Preview is isolated, protected at its human-facing console paths, and currently fail-closed. It is not activated for autonomous task execution, recurring scheduling, reviewer sign-in, AI inference, content writes, article publishing, or social publishing. This record is operational evidence, not Production release approval.

## Repository and integration state

- Repository: `manhdungub-boop/ai-thuc-chien-blog` (GitHub only).
- [PR #327](https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/327) remains OPEN / DRAFT / UNMERGED.
- Base branch: `main` at `6a5cfa2398ee72f12335942b1ceb0830e6b8add9`.
- Integration branch: `integration/agent-runtime-v5-preview-20261120`.
- Current integration head at this status capture: `473320bd20e4a1ed556b3cb6892a656e5c30134e`.
- GitHub compares the PR as 475 commits ahead, 0 behind, 157 changed files (19,771 line changes). The size of this integration diff is a material review/release risk; successful CI is not by itself a reason to merge.
- Child security PR [#368](https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/368) was merged into the integration branch through merge commit `473320bd20e4a1ed556b3cb6892a656e5c30134e`. Child commit `0846d66c97fcf7ae1d2a57e64dbb2de80b34331e` and the merge commit have the same Git tree `6143eaffb06176b8dc4ddfaf7499140b098e76da`; the source tree tested by child E2E is therefore the same tree now in PR #327.
- Security-gate [Issue #298](https://github.com/manhdungub-boop/ai-thuc-chien-blog/issues/298) was closed as completed on 2026-11-24 after the replacement acceptance criteria were met.
- The repository owner waived the independent third-party human security-review prerequisite. The `daingo11` review is AI-assisted at the owner's direction, not an independent audit.

## Exact-head review and CI evidence

For PR #327 current head `473320bd20e4a1ed556b3cb6892a656e5c30134e`:

- CodeRabbit APPROVED and `daingo11` APPROVED on the exact current head (latest `daingo11` approval at 2026-11-24 07:36:07 UTC).
- All 3 inline review threads on PR #327 are resolved.
- 21/21 check runs completed: 20 success, 1 skipped. The skipped `one-shot-preview-e2e` did not run on the branch-push event; do not count it as an exact-head E2E execution.
- The same Git tree passed the protected one-shot Preview E2E on child commit `0846d66c97fcf7ae1d2a57e64dbb2de80b34331e`, [run 45342369885](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/45342369885): OIDC admission, one allowlisted read-only `content.review`, pass result with zero findings, persisted audit verification, all four console assets redirecting to Cloudflare Access login, automatic Preview restore, and cleanup.
- Exact-head CI includes successful validate/verify, community API, editorial smoke, Cloudflare Pages, Preview Worker build, CodeQL and dedicated JavaScript/TypeScript, Python and GitHub Actions analysis.
- The E2E workflow is intentionally restricted to a narrowly allowlisted PR synchronize event, repository, branch, actor, label, and protected Preview environment. The skipped parent check is expected for a merge commit pushed to the integration branch.

## Dedicated Preview Worker — Cloudflare read-only evidence

- Worker: `ai-thuc-chien-agent-runtime-preview`.
- Latest observed deployment: version `d9ccc9c1-f894-4248-9ff2-1eebd3a89076`, deployment `0c6fb457-d981-412d-88ec-0af21bf4cb63`, created 2026-11-24 06:43:36 UTC; 100% of this dedicated Worker's traffic.
- The deployment followed the protected one-shot E2E and restored the Worker to the disabled/paused configuration. The deployed source tree is the same Git tree as the current PR head; the deployment's commit SHA is not asserted to equal the later merge commit SHA.
- Four SQLite-backed Durable Object namespaces are bound:
  - `AgentStateStore`: `d69e58a5f50841eaa5e2205775495c1e`
  - `AgentReviewerAuthStore`: `c237a7503cdf4f1794da1088e3abfc3c`
  - `AgentDraftStore`: `bc51627bf1d942139fafdab20f9657a6`
  - `AgentAIBankCandidateStore`: `4d73cac1e69a45b5bf66db1ddb4bf219`
- The rate-limit binding is configured at 60 requests per 60 seconds per Cloudflare location. This is approximate and location-scoped, not a strict global cap.
- The secret binding name `AGENT_STATE_STORE_TOKEN` exists; its value was not read. No shared-bearer `AGENT_OPERATOR_TOKEN` or `AGENT_OPERATOR_ID` is configured.
- Four path-scoped Cloudflare Access applications protect only:
  - `/operator-console`
  - `/operator-console.js`
  - `/reviewer-console`
  - `/reviewer-console.js`
- Each Access application has one allow policy named `Allow project owner only`, scoped to `manhdungub@gmail.com`. The E2E verified unauthenticated requests receive HTTP 302 to the Cloudflare Access login endpoint. These are four path-scoped apps, not an account-wide or Worker-wide Access policy. Machine OIDC routes remain separate.

## Live fail-closed configuration

Read-only Cloudflare settings at 2026-11-24 06:43 UTC:

| Setting | Value | Meaning |
|---|---:|---|
| `AGENT_ENABLED` | `false` | Task execution disabled |
| `AGENT_PAUSED` | `true` | Durable pause asserted |
| `AGENT_SCHEDULER_ENABLED` | `false` | Scheduler disabled |
| `AGENT_RECOVERY_ALARM_ENABLED` | `false` | Recovery alarm disabled |
| `AGENT_REVIEWER_AUTH_ENABLED` | `false` | Reviewer sign-in disabled |
| `AGENT_OIDC_ENABLED` | `true` | Restricted manual Pause-only OIDC control |
| `AGENT_CONSOLE_ACCESS_PROTECTED` | `true` | Console protection assertion enabled |
| `AGENT_RATE_LIMIT_REQUIRED` | `true` | Ingress rate limit required |

- OIDC trust is pinned to this repository, owner/repository IDs, `refs/heads/main`, and `.github/workflows/agent-runtime-operator.yml`.
- The operator workflow is manual-only, main-ref-only, minimally privileged, serialized, Preview-scoped, and Pause-only. It has no Resume, enqueue, deploy, or task-execution operation.
- Cloudflare reports no Cron schedules.
- The Preview hostname uses `workers.dev`; Preview URLs are disabled. No Production route, D1, KV, R2, queue consumer, or custom domain is configured for this Worker.

## Free-tier and resource evidence

Read-only point-in-time telemetry observed on 2026-11-24 UTC:

- The protected E2E Free-plan preflight succeeded using a complete Cloudflare subscription listing. The workflow fails closed if the plan cannot be verified or if a paid Workers subscription is found.
- Account-wide Workers telemetry at query time: 223 requests, 0 errors, 267 subrequests, 682,807 microseconds aggregate CPU.
- Durable Objects telemetry at query time: 110 requests, 0 errors; 180,883 microseconds CPU; 0.169475712 GB-s duration; 4,336 SQL rows read; 383 SQL rows written; zero exceeded-CPU, exceeded-memory, or fatal internal errors.
- State Store SQLite storage observed: 151,552 bytes. The published Workers Free account-wide SQLite DO storage limit is 5 GB; the observation is approximately 0.003% of that limit.
- These are telemetry observations, not a guarantee of future quota headroom. GraphQL telemetry is not a billing ledger. Do not enable paid plans, overage, pay-as-you-go, recurring jobs, or additional workload without separate owner approval and fresh resource evidence.

## Test coverage versus remaining live Preview gates

The repository contains automated unit/simulation coverage for OIDC replay-state handling, authentication boundaries, lease fencing, lease recovery, Pause/Emergency Stop decisions, rate-limit admission, quota evidence, and fail-closed runtime admission. Relevant tests include:

- `state-store-oidc-replay.test.mjs`
- `github-oidc-worker.test.mjs`
- `auth-boundary.test.mjs`
- `lease-fencing-simulation.test.mjs`
- `lease-recovery-simulation.test.mjs`
- `agent-safety-supervisor.test.mjs`
- `usage-admission.test.mjs`

Those tests are not substitutes for live fault-injection. Remaining live Preview validation before a future release decision:

1. Negative auth and OIDC claim/replay rejection on the deployed Preview.
2. Pause during an in-flight task, including cancellation and durable terminal/audit behavior.
3. Stale lease owner/generation rejection against the live State Store, not simulation only.
4. Rate-limit exhaustion and quota/provider failure behavior under controlled, bounded conditions.
5. Recovery and rollback behavior under a deliberately induced recoverable failure.
6. Verify all temporary credentials/configuration are removed and the Worker returns to disabled/paused state after each test.

The successful one-shot E2E already proves the allowlisted read-only `content.review` path, persisted audit result, console Access redirects, and automatic disabled/paused restore. Do not repeat it merely to duplicate evidence.

## Production exclusion and release rule

- Cloudflare Production Worker `ai-thuc-chien-blog` last reported `modified_on=2026-11-23T05:13:33.486779Z`; its deployment history remains unchanged in this work.
- The Cloudflare Workers Builds Production trigger is restricted to branch `main`; the integration-branch build used `npx wrangler preview`.
- No Production Worker, D1, DNS, secrets, OAuth configuration, billing/payment settings, public content, Facebook publishing, or user/member data was changed.
- Keep PR #327 Draft / open / unmerged. Do not merge to `main`, deploy Production, enable task execution, enable scheduling/recovery, enable reviewer sign-in, create/rotate secrets, run AI inference, or publish content/social posts without a separate explicit owner-approved release/activation decision.
