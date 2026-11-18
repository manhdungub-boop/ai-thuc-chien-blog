# AI Thực Chiến — 24/7 Agent Runtime (Preview only)

This directory is a separate Cloudflare Worker service. It is not imported by the public website Worker and has no Production route, D1 binding, AI binding, secrets, social integrations, or deploy workflow.

## Runtime model

- Cloudflare Workflows provides durable, retryable execution.
- A Workflow schedule creates a recurring supervisor run every 15 minutes (UTC).
- The current supervisor is intentionally a safe heartbeat/planning shell: it records the scheduled cycle in Workflow state and returns an explicit idle result. It does not claim to run specialist models or process real tasks yet.
- `GET /health` is public and returns only service metadata.
- No HTTP endpoint can enqueue arbitrary work in this phase.
- No task payloads, personal data, credentials, or website data are stored or transmitted.

## Local validation

Run from this directory with a current Wrangler 4 release:

```sh
npx wrangler types --config wrangler.jsonc
npx wrangler deploy --dry-run --config wrangler.jsonc
```

Do not deploy from this branch until the separate Preview account/resource boundary, free-tier quota, and workflow schedule are verified. There is deliberately no CI deploy job.

## Next gated phases

1. Add a durable task store isolated from website D1 and test idempotency, lease expiry, retry and dead-letter behavior.
2. Add read-only GitHub/public-source adapters with bounded timeouts and rate limits.
3. Add model execution only after verifying a genuinely no-cost quota; otherwise remain in deterministic planning mode.
4. Add staging-only AI Bank/content/QA specialists with evidence contracts.
5. Add an authenticated operator control plane, alerting and a pause switch.
6. Consider public actions only through the existing owner approval gates.

A scheduled Workflow is a recurring background service, not a guarantee of uninterrupted model inference. Account limits, platform incidents, and quota exhaustion can pause work; the runtime must fail closed rather than enable billing.
