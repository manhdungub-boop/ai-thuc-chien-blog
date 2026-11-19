# AI Thuc Chien Agent Runtime — Preview shell

Status: **scaffold only; not an autonomous agent and not deployed**.

## Safety boundary

- Separate Worker name: `ai-thuc-chien-agent-runtime-preview`.
- No account ID, production route, custom domain, D1 binding, KV/R2 binding, Durable Object binding, secret, cron trigger, or queue consumer is configured.
- `AGENT_ENABLED=false` and `AGENT_PAUSED=true` are the checked-in defaults.
- `POST /run` fails closed while disabled or paused.
- Even if both flags are manually opened, execution returns `501 execution_not_implemented`; no task execution exists in this scaffold.
- `GET /health` returns only non-sensitive state.
- No deploy workflow is provided. CI only runs local Node.js tests and syntax checks.

## Local validation

From the repository root:

```sh
node --check agents/runtime/src/worker.mjs
node --test agents/runtime/tests/*.test.mjs
```

## Next implementation gates

1. Task contract is implemented as validation-only: `content.review`, `ai_bank.candidate_review`, and `seo.audit` have strict payload allowlists, bounded size, path validation, and idempotency-key syntax.
2. Add authenticated operator-only enqueue and inspect paths; the contract does not enqueue or execute work.
3. Add idempotency, bounded payloads, quota guard, and audit events.
4. Add isolated storage only after schema and retention review.
5. Add a separately reviewed Preview deployment workflow; do not add schedules until kill-switch and budget tests pass.

This scaffold makes no claim of 24/7 execution, backup readiness, or production recovery.
