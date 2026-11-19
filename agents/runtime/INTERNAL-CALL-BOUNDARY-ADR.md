# Agent Runtime — internal Worker-to-State-Store security boundary

Status: **design only; no Durable Object binding, secret, public operator API, or deployment is configured.**

Date: 2026-11-19

## Decision

Keep the SQLite Durable Object reachable only through the Agent Runtime Worker code path. Do not expose a public route that forwards arbitrary caller-supplied paths, headers, or bodies to the Durable Object.

Before adding a Durable Object binding, separate external operator authentication from internal State Store authentication:

- `AGENT_OPERATOR_TOKEN`: authenticates an authorized operator at the Worker ingress. It must never be forwarded to the Durable Object or exposed to browser code.
- `AGENT_STATE_STORE_TOKEN`: a distinct high-entropy secret used only by the Worker when calling the Durable Object and by the Durable Object when authenticating that internal call. It must never be accepted as an external operator credential.
- Both values must be injected as Preview-only secrets. Neither belongs in source, Wrangler vars, CI logs, task payloads, audit metadata, URLs, or client-side JavaScript.
- If either secret is absent, malformed, or unavailable, the relevant operation fails closed.

## Request path

1. The Worker authenticates the incoming operator using the approved ingress mechanism. For browser-based administration, use a server-validated session or an access-control layer; never embed a shared bearer secret in browser JavaScript.
2. The Worker validates the requested operation and maps it to one of the fixed task-store operations. The caller cannot choose a Durable Object ID, internal URL, path, or arbitrary headers.
3. The Worker obtains the single configured Durable Object stub using the fixed logical name `agent-runtime-global`.
4. The Worker creates a new internal request and sets only the dedicated `AGENT_STATE_STORE_TOKEN` bearer credential. It must not forward the caller's Authorization header, cookies, Origin, or arbitrary headers.
5. The Durable Object authenticates the internal token before route handling and validates the exact method, path, and request schema.
6. Responses are reduced to allowlisted fields; internal stack traces, SQL errors, secret material, and raw environment values are never returned.

## Additional controls

- Do not expose a generic `/proxy`, `/do/*`, or arbitrary state-store passthrough route.
- Do not accept a Durable Object ID or namespace name from the request body or query string.
- Keep the existing `AGENT_ENABLED=false` and `AGENT_PAUSED=true` defaults. The Worker must check these flags before reservation or dispatch; the State Store independently checks them before admitting work or transitioning a queued task to running.
- A pause may still permit safe terminal bookkeeping (for example, cancellation) but must not permit new reservations or new claims.
- Apply request-size limits before JSON parsing, strict schemas after parsing, no-store response headers, and bounded error messages.
- Rate-limit ingress and inspection operations before any public exposure. Record non-sensitive audit metadata only.
- Use a dedicated Preview-only Wrangler config for the namespace binding. Do not add the binding to the production site Worker or the existing unbound shell config.

## Required tests before binding

1. Missing, invalid, and rotated internal tokens fail closed for every State Store route.
2. An external operator token is rejected by the State Store; an internal State Store token is rejected by the Worker ingress.
3. The Worker never forwards caller Authorization, cookies, Origin, or arbitrary headers.
4. The Worker can call only the fixed Durable Object identity and allowlisted operations.
5. Missing binding, missing secret, storage failure, and malformed response all fail closed without memory fallback.
6. Paused/disabled flags block reservations and queued-to-running transitions while allowing only explicitly safe terminal cleanup.
7. No secret appears in logs, responses, task rows, audit rows, traces, or CI output.
8. Preview configuration has no production route, custom domain, D1 binding, production namespace, queue, or schedule.

## Release gate

This ADR does not authorize adding the binding, creating or setting secrets, deploying a Worker, exposing operator routes, enabling the Agent, or changing Production. Those actions require the independent source/security review, verified Free-plan budget, isolated Preview configuration, passing tests, and an explicit operational release gate.

No Production Worker, DNS, D1, live data, billing, or social account is changed by this design.
