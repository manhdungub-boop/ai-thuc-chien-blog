# AI Thực Chiến — 24/7 Agent Runtime (Preview only)

This directory is a separate Cloudflare Worker service. It is not imported by the public website Worker and has no Production route, website D1 binding, AI binding, secrets, social integrations, or deploy workflow.

## Runtime foundation

- Cloudflare Workflows creates a recurring supervisor run every 15 minutes (UTC), with concurrency limited to one.
- A separate SQLite-backed Durable Object provides a durable task queue. It is not the website's D1 database.
- Queue contracts include an allowlist of task types, per-agent payload schemas, an 8 KiB payload ceiling, idempotent task IDs, a 500-task active-queue ceiling, five-minute leases with unique fencing tokens, a five-attempt ceiling, a dead-letter state, and rejection of stale worker completion.
- Queue operations are internal Durable Object RPC methods only. There is no public task-enqueue endpoint.
- The scheduled supervisor runs every 15 minutes, enqueues an idempotent `runtime_health_check`, claims only that task type and task ID, executes a deterministic local health check, and persists a bounded result.
- Once per UTC day, the supervisor enqueues an idempotent `ai_bank_discovery` task. Its only handler fetches ten hard-coded public GitHub Atom release feeds over HTTPS using GET, rejects redirects, applies a 10-second per-source timeout and a 1 MB response ceiling, validates release URLs against the exact repository, and stores at most ten sanitized recent signals in the task result.
- The same daily cycle enqueues one idempotent `content_research` task for the fixed topic `AI agents, automation, and open-source AI tools`. Its discovery handler reads four fixed public feeds: OpenAI News, Google DeepMind, Hugging Face, and arXiv cs.AI. It uses GET only, rejects redirects, applies an 8-second timeout and a 750 KB response ceiling per feed, validates HTTPS host and path, and stores at most five recent source signals.
- Research results are not an AI-generated article, a fact-checked report, or permission to publish. The handler does not fetch article bodies, infer claims, or write website content. A later research specialist must read original sources and corroborate material claims before any draft is created.
- Discovery is read-only. Release signals are not verified AI Bank records; no pricing, free quota, license, privacy, regional availability, or product suitability is inferred. There is no catalog write, public content write, or publication step.
- The supervisor processes at most three tasks per cycle (one health task, one AI Bank release scan, and one research-source scan). It makes no model calls and does not access private GitHub data.
- `content_research` is currently limited to the fixed daily read-only source-discovery task described above; it is not free-form topic research. `content_draft` and `quality_review` remain queued task contracts without registered executors and are not claimed by the supervisor.
- Completed task results are stored in the isolated queue database with an 8 KiB ceiling; completed/dead retention cleanup is not yet scheduled.
- `GET /health` exposes service metadata only. No personal data, credentials, or website data are stored or transmitted by the current code.

## Emergency pause

- `AGENT_PAUSED=true` stops the supervisor before it accesses the Durable Object queue or makes any outbound request.
- The Preview default is `false`; operators can set it to `true` in the isolated Preview configuration to stop scheduled processing. This switch is not connected to the public website Worker.
- Keep the service paused until Preview resource boundaries, current free-tier usage, and the deployment plan have been reviewed. No Production configuration is changed by this PR.

## Free-tier guardrails

Cloudflare publishes plan-specific limits and pricing for Workflows and SQLite-backed Durable Objects. Exact remaining quota depends on the account and its other workloads; this repository does not have verified access to the account's current usage. Do not assume the service is free at any scale. Before Preview deployment, confirm the account's current free-tier limits and usage in the dashboard. The runtime must fail closed at its configured queue ceiling; no paid plan or billing change is authorized.

## Validation and deployment

Run from this directory with a current Wrangler 4 release:

```sh
npx wrangler types --config wrangler.jsonc
npx wrangler deploy --dry-run --config wrangler.jsonc
```

Do not deploy from this branch until the separate Preview account/resource boundary, free-tier quota, and Workflow schedule are verified. There is deliberately no CI deploy job. A Durable Object migration is a resource change and must be reviewed before any Preview deployment.

## Next gated phases

1. Exercise queue behavior against a local Durable Object emulator: idempotency, concurrent claims, lease expiry, retry and dead-letter behavior.
2. Connect the supervisor to the queue while retaining a strict task-type allowlist.
3. Add read-only GitHub/public-source adapters with bounded timeouts and rate limits.
4. Add model execution only after verifying a genuinely no-cost quota; otherwise remain in deterministic planning mode.
5. Add staging-only AI Bank/content/QA specialists with evidence contracts.
6. Add an authenticated operator control plane, monitoring, alerting and a pause switch.
7. Consider public actions only through the existing owner approval gates.

A scheduled Workflow is a recurring background service, not a guarantee of uninterrupted model inference. Account limits, platform incidents, and quota exhaustion can pause work; the runtime must fail closed rather than enable billing.
