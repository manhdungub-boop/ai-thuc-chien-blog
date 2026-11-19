# AI Thuc Chien Agent Runtime — Preview shell

Status: **scaffold only; not an autonomous agent and not deployed**.

## Safety boundary

- Separate Worker name: `ai-thuc-chien-agent-runtime-preview`.
- No account ID, production route, custom domain, D1 binding, KV/R2 binding, Durable Object binding, secret, cron trigger, or queue consumer is configured.
- `AGENT_ENABLED=false` and `AGENT_PAUSED=true` are the checked-in defaults.
- `POST /run` fails closed while disabled or paused.
- If both flags are manually opened, `POST /run` requires an `Authorization: Bearer` token matching the externally injected `AGENT_OPERATOR_TOKEN`; missing or invalid credentials fail closed with `401`. A valid token still receives `501 execution_not_implemented`; no task execution exists.
- Operator bearer validation uses SHA-256 digests with constant-time byte comparison. The secret is never committed, logged, or returned; no secret is configured in this repository.
- `GET /health` returns only non-sensitive state.
- No deploy workflow is provided. CI only runs local Node.js tests and syntax checks.

## Local validation

From the repository root:

```sh
node --check agents/runtime/src/worker.mjs
node --test agents/runtime/tests/*.test.mjs
```

## Implemented validation-only building blocks

- `src/task-contract.mjs` accepts only `content.review`, `ai_bank.candidate_review`, and `seo.audit`; each has exact payload keys, bounded serialized size, and strict local path/identifier validation.
- `src/operator-auth.mjs` validates an externally supplied operator bearer token and fails closed when the secret is absent or weak.
- `src/admission-policy.mjs` makes a pure fail-closed admission decision from explicit limits and trusted usage counters; it rejects missing/invalid values, daily quota exhaustion, concurrency saturation, and oversized payloads. Safety caps are 1,000 tasks/day, 100 concurrent tasks, and 8 KiB per payload.
- These modules validate requests only. The admission policy does not reserve capacity, count usage, enqueue, persist, execute tasks, or schedule work. There is no trusted durable usage store, so this is not yet real quota enforcement.

## Next implementation gates

1. Task contract is implemented as validation-only: `content.review`, `ai_bank.candidate_review`, and `seo.audit` have strict payload allowlists, bounded size, path validation, and idempotency-key syntax.
2. Add authenticated operator-only enqueue and inspect paths; the contract does not enqueue or execute work.
3. Connect admission decisions to an atomic durable usage/idempotency store; the current policy is not an enforcement mechanism until counters are trusted and updated transactionally.
4. Add append-only audit events with retention and privacy review.
5. Add isolated storage only after schema, concurrency, and retention review.
6. Add a separately reviewed Preview deployment workflow; do not add schedules until kill-switch and budget tests pass.

This scaffold makes no claim of 24/7 execution, backup readiness, or production recovery.
