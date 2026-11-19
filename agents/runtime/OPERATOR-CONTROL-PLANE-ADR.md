# Agent Runtime Operator Control Plane — ADR

Status: **proposed design; not implemented or enabled**  
Scope: isolated Agent Runtime Preview only. This document does not authorize a deployment, binding, secret, Durable Object namespace, scheduler, task execution, or Production change.

## Context

The State Store implements authenticated reserve, claim, heartbeat, completion, and manual lease recovery operations. The current Worker shell exposes only read-only usage/task inspection. It does not expose an operator recovery route, a dynamic pause control, or a browser-safe administration surface.

The current `AGENT_ENABLED` and `AGENT_PAUSED` environment flags are deployment-time gates. They are not a remote kill switch. The internal `AGENT_STATE_STORE_TOKEN` is a service credential and must never be sent to a browser.

## Decision

Use a server-side control plane between the operator identity provider and the State Store. Keep the State Store private behind the existing dedicated Worker-to-DO credential. Do not expose Durable Object routes directly to the public internet.

### Trust boundaries

1. **Operator client** — browser or approved operator client. It receives only a short-lived authenticated session; never a State Store token or raw operator bearer.
2. **Identity/session layer** — validates the operator identity server-side. Prefer an established identity gateway with MFA and an allowlist of named operators. Do not invent a home-grown password store.
3. **Control-plane Worker** — enforces role, action allowlist, CSRF protection for cookie sessions, request validation, rate limits, confirmation requirements, and audit attribution.
4. **State Store Durable Object** — remains private; accepts only the dedicated internal service credential and validates every state transition transactionally.

If the identity gateway, session validation, or required free-tier security controls cannot be verified, keep the control plane unavailable. Do not substitute a public bearer-token endpoint.

## Proposed permissions

| Capability | Permission | Behavior |
|---|---|---|
| Inspect health, usage, task metadata | `runtime.read` | Read-only; redact payload, lease owner, and secrets |
| Pause admissions and claims | `runtime.pause` | Immediately deny new reservations and claims after the persisted pause state is observed |
| Resume admissions and claims | `runtime.resume` | Require explicit confirmation and healthy prerequisite checks |
| Recover one expired lease | `runtime.recover` | One task ID per request; require expired lease, current state, and attempt ceiling validation |
| Change deployment flags/secrets | Not exposed | Separate reviewed deployment procedure only |

No wildcard/admin permission should be granted by default. Resume and recovery should require a second explicit confirmation step in the operator interface. Read access must not imply write access.

## Pause and resume semantics

- Persist a control record in the same Durable Object as task state so pause checks and task admission/claim transactions share a serialization boundary.
- Keep deployment flags as an independent outer safety gate: `AGENT_ENABLED=true` and `AGENT_PAUSED=false` are still required before work can be admitted or claimed.
- A persisted pause blocks new reservations, new claims, and lease recovery.
- A task already holding a valid lease may heartbeat and complete while paused so it can reach a safe terminal state.
- Pause does **not** forcibly interrupt an already-running external side effect. Every future handler must support cooperative cancellation or document its non-interruptible boundary.
- Resume must not automatically execute queued work. It only reopens admission/claim after checks; a separate worker/dispatcher is not part of this ADR.
- If control-state reads fail, reject writes and keep admission/claim closed.

## Recovery semantics

- Expose recovery only for a single explicitly named task per request in the first release.
- The State Store remains authoritative for lease expiry, fencing generation, attempt count, and retry delay.
- Reject early recovery, stale generation, non-running tasks, and tasks at the retry ceiling.
- Recovery must not call a task handler or repeat an external side effect. It only updates task state and audit history.
- Do not introduce batch recovery or automatic scheduling until per-task idempotency and the operator workflow have been independently validated.

## Audit, abuse prevention, and browser security

- Record immutable operator identity, action, target task ID (if any), timestamp, request/correlation ID, result, and reason code. Never record credentials, cookies, full task payloads, or sensitive personal data.
- Apply per-operator and global rate limits to every mutating action. Fail closed if rate-limit storage is unavailable.
- Use secure, HttpOnly, SameSite cookies for browser sessions; enforce CSRF tokens and Origin checks for cookie-authenticated mutations.
- Require MFA at the identity provider. Use short session lifetime and explicit logout/revocation.
- Validate request schema and reject unknown fields, duplicate query parameters, oversized bodies, and unsupported methods.
- Return generic errors externally; retain detailed diagnostics only in access-controlled logs.
- Add security headers and no-store caching to all control-plane responses.

## API shape (proposed; not implemented)

- `GET /operator/health` — read-only status with redacted fields.
- `GET /operator/usage` — read-only quota counters.
- `GET /operator/tasks/:id` — allowlisted task metadata only.
- `POST /operator/pause` — pause new admission and claims.
- `POST /operator/resume` — reopen admission/claims after explicit confirmation.
- `POST /operator/tasks/:id/recover` — recover one eligible expired lease.

All routes require server-validated operator sessions and capability checks. Mutating routes require CSRF protection, rate limits, an audit reason, and an idempotency key. These paths are design examples, not routes that currently exist.

## Failure handling and rollback

- Missing/invalid identity, session, CSRF token, internal credential, binding, or control-state record: fail closed.
- State Store or rate-limit storage unavailable: reject mutating requests; do not silently fall back to in-memory state.
- Unexpected state transition: return conflict and preserve the existing task row.
- Rollback: disable the isolated Preview control-plane route or revert its Preview deployment; retain the State Store data for forensic review. No Production route or Worker is involved.
- Never store or expose secrets in source control, browser bundles, URLs, or audit metadata.

## Required acceptance gates before implementation

1. Verify a no-cost identity gateway/session option and its account entitlement; no paid upgrade, billing activation, or payment setup.
2. Threat-model operator compromise, CSRF, replay, session theft, rate-limit bypass, and internal-token exfiltration.
3. Implement persisted pause state and prove transactionally that concurrent reserve/claim calls cannot pass it.
4. Prove resume does not dispatch queued tasks and pause does not falsely claim to stop already-running side effects.
5. Prove recovery requires an expired lease and is idempotent under duplicate operator requests.
6. Verify operator audit attribution and that logs contain no secrets or task payloads.
7. Run targeted integration/security tests and isolated Preview smoke; preserve the existing Draft PR and do not merge.
8. Confirm free-tier usage headroom before creating any namespace, binding, secret, or deployed control-plane resource.

## Explicit non-goals

- No public admin dashboard in this phase.
- No direct browser-to-Durable-Object calls.
- No task execution engine, external side effects, scheduler, alarm, cron, or 24/7 claim.
- No automatic resume, batch recovery, or recovery of non-expired leases.
- No changes to Production Worker, DNS, D1, secrets, routes, or user data.
