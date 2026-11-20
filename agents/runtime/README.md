# AI Thuc Chien Agent Runtime — Preview shell

Status: **isolated validation scaffold; no Agent Runtime Worker deployment and no autonomous task execution**.

## Safety boundary

- Separate intended Worker name: \`ai-thuc-chien-agent-runtime-preview\`.
- No account ID, production route, custom domain, D1 binding, KV/R2 binding, Durable Object binding, secret, cron trigger, or queue consumer is configured in \`wrangler.jsonc\`.
- \`AGENT_ENABLED=false\` and \`AGENT_PAUSED=true\` are the checked-in defaults.
- \`POST /run\` fails closed while disabled or paused.
- If both flags are manually opened, \`POST /run\` requires an \`Authorization: Bearer\` token matching the externally injected \`AGENT_OPERATOR_TOKEN\`; missing or invalid credentials fail closed with \`401\`. A valid token still receives \`501 execution_not_implemented\`; no task execution exists.
- Operator bearer validation uses SHA-256 digests with constant-time byte comparison. The secret is never committed, logged, or returned; no secret is configured in this repository.
- \`GET /health\` returns only non-sensitive state.
- This PR does not deploy the Worker. A separate dependent PR (#326) proposes a manual-dispatch-only Preview workflow restricted to `main` and an explicit Preview confirmation; it remains Draft/unmerged and requires the dedicated `CLOUDFLARE_AGENT_PREVIEW_API_TOKEN`, which is not currently configured. CI in this PR runs local tests and static configuration checks.

## Implemented validation-only building blocks

- \`src/task-contract.mjs\` accepts only \`content.review\`, \`ai_bank.candidate_review\`, and \`seo.audit\`; exact payload keys, bounded size, safe local paths, and idempotency-key syntax are enforced.
- \`src/operator-auth.mjs\` validates an externally supplied operator bearer token and fails closed when the secret is absent or weak.
- \`src/admission-policy.mjs\` remains a pure fail-closed policy helper; it is not the quota authority.
- \`src/state-store.mjs\` implements a SQLite-backed Durable Object class, but the class is **not bound** in the checked-in Preview Worker config. It supports durable idempotency, UTC daily counters, derived in-flight counts, atomic admission reservations, constrained state transitions, and bounded retention. It stores only the validated small task payload, its hash, and non-sensitive audit metadata.
- The state store is not connected to \`POST /run\`; no task is enqueued or executed by the Worker shell.

## Local integration validation

The validation workflow installs the pinned open-source Miniflare simulator and runs the Durable Object against local \`workerd\` with SQLite enabled. Tests cover duplicate keys, payload conflicts, concurrent admission at quota boundaries, terminal transitions, UTC day rollover, transaction rollback, and persistence after a runtime restart.

From the repository root:

\`\`\`sh
npm install --no-save --no-package-lock --ignore-scripts miniflare@4.20260730.0
node --check agents/runtime/src/worker.mjs
node --check agents/runtime/src/state-store.mjs\nnode --check agents/runtime/src/internal-auth.mjs\nnode --check agents/runtime/src/state-store-client.mjs
node --test agents/runtime/tests/*.test.mjs
\`\`\`

The GitHub Actions workflow is authoritative for the test dependency tree: it applies isolated npm overrides for the patched `sharp` and `undici` versions and fails on remaining High/Critical advisories. This is local-runtime evidence, not a live Cloudflare deployment test. Miniflare is a development simulator, not a hardened security boundary.

## Limits and retention

- Enforced pilot ceilings: 100 accepted tasks/day, 5 in-flight tasks, and 8 KiB serialized task request. The implementation rejects higher configured values; these are code-level limits, not measured account quota.
- Daily usage is counted in UTC. In-flight usage is derived from rows in \`queued\` or \`running\`, not an in-memory counter.
- Completed/failed/cancelled task rows are retained for 30 days; audit events and daily-usage rows are retained for 90 days. Idempotency protection therefore lasts for the task-retention period.
- Storage errors, unsupported schema versions, and invalid limits fail closed. There is no memory fallback.
- These are internal guardrails, not proof of remaining Cloudflare account quota or a guarantee of uninterrupted service.

## Durable state-store decision

See [STATE-STORE-ADR.md](./STATE-STORE-ADR.md) for the design decision, Free-tier budget, transaction boundary, failure behavior, and remaining gates.

## Remaining gates

1. Independently review the state-store implementation, fixed-operation client, and integration-test results.
2. Review the Free-tier request/SQL-row budget against expected real workload.
3. Wire the fixed-operation client behind authenticated Worker ingress only after independent review; then add a Durable Object binding and SQLite migration only to a separate Runtime Preview config. Do not change the current checked-in Preview config in this step.
4. Deploy the separate Preview Worker only after the local gates pass and Preview-only permissions are explicitly available.
5. Add authenticated operator-only enqueue/inspect routes only after a separate security review.
6. Add execution, alarms, or schedules only after idempotent side-effect handling, kill-switch behavior, recovery, and operational monitoring are proven.

This scaffold makes no claim of 24/7 execution, backup readiness, or production recovery.
