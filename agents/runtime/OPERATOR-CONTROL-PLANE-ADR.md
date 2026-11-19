# Agent Runtime Operator Control Plane — ADR

Status: **partial internal control bridge implemented and tested; not deployment-ready**  
Scope: isolated Agent Runtime Preview only. This ADR does not authorize a Durable Object namespace, binding, secret injection, deployment, task execution, or Production change.

## Current implementation (2026-11-20)

The current branch contains the following Worker-to-State-Store routes:

- `GET /internal/control`
- `POST /internal/control/pause`
- `POST /internal/control/resume`
- `GET /internal/usage`
- `GET /internal/task?id=...`

The control mutation bridge requires the external `AGENT_OPERATOR_TOKEN`, a configured `AGENT_OPERATOR_ID`, and a separate `AGENT_STATE_STORE_TOKEN` for the internal Durable Object call. The Worker creates the actor and request ID; callers cannot supply an actor. The State Store persists pause state, control audit events, and a per-actor rate limit (10 mutations per 60-second window). The Durable Object namespace is not bound in the checked-in Wrangler configuration, so these routes cannot reach a deployed State Store in the current Preview shell.

Control mutation request bodies are bounded before JSON parsing: 1 KiB at Worker ingress and 16 KiB independently at the State Store. Declared lengths and streamed bytes are checked; oversized bodies return 413 and malformed JSON returns 400. The isolated Agent Runtime suite passes 65/65 tests on code commit `5f195da33fe36e822517d1a62a3449241e3f89f3`.

The current operator identity is a static deployment-configured label, **not proof of an authenticated human identity**. The shared bearer token does not provide named-user attribution, MFA, session expiry, revocation per person, or role-based permissions. Do not describe this bridge as a browser-safe operator console or as a verified human identity system.

The State Store and Worker code are covered by isolated tests, but the control routes are not deployment approval. The Runtime remains disabled by default, unbound, and without a task handler or scheduler.

## Trust boundaries and limitations

1. **External caller** — controlled operator tooling only. Do not put the shared bearer token in browser JavaScript, public pages, URLs, logs, or client-side storage.
2. **Worker ingress** — validates the external bearer, validates the fixed route and request fields, creates the configured actor and request ID, and forwards only the dedicated internal credential.
3. **Worker-to-State-Store call** — uses the fixed Durable Object identity and fixed internal paths. Caller cookies, Origin, Authorization, and arbitrary headers are not forwarded.
4. **State Store** — accepts only the separate internal service credential and applies transactional state changes, persistent rate limiting, and audit recording.

Before any broader operator access, replace the shared-token-only ingress with a verified identity/session layer. Prefer a no-cost, already-entitled identity gateway with MFA and a named-operator allowlist. If its free entitlement cannot be verified, keep operator mutation unavailable. Do not invent a home-grown password store or expose a public bearer-token endpoint.

## Implemented permissions and routes

| Route | Current behavior | Limitation |
|---|---|---|
| `GET /internal/control` | Read persisted pause state | Shared bearer only |
| `POST /internal/control/pause` | Persist pause and audit action | Static actor label; no human identity proof |
| `POST /internal/control/resume` | Persist resume and audit action | No second-person approval or independent health gate |
| `GET /internal/usage` | Return allowlisted usage counters | No global read-rate limit |
| `GET /internal/task?id=...` | Return allowlisted task metadata | Shared bearer only |

There is no Worker recovery route. The State Store's `/recover` endpoint is not exposed by the Worker bridge. Do not add it without a separate review and targeted tests.

## Pause and resume semantics

- The persisted control row lives in the same Durable Object as task state so pause checks and task admission/claim transactions share a serialization boundary.
- Deployment flags remain independent outer gates: `AGENT_ENABLED=true` and `AGENT_PAUSED=false` are still required before admission or claims.
- A persisted pause blocks new reservations, new claims, and lease recovery.
- A task already holding a valid lease may heartbeat and complete while paused so it can reach a safe terminal state.
- Pause does **not** forcibly interrupt an already-running external side effect. Future handlers must support cooperative cancellation or document their non-interruptible boundary.
- Resume does not automatically dispatch queued work. No dispatcher or task handler exists.
- Missing or unreadable control state must fail closed.

## Security gaps before deployment or broader exposure

- **Human identity:** `AGENT_OPERATOR_ID` is static configuration. A shared bearer holder can perform mutations under that label; the audit trail is not person-level attribution.
- **MFA/session lifecycle:** no MFA, short-lived session, per-user revocation, or role-based authorization is implemented.
- **Browser protections:** no cookie session, CSRF token, or Origin validation is implemented. Keep the bridge off browser-facing surfaces.
- **Request body bounds:** implemented on the current branch. The Worker rejects control mutation bodies above 1 KiB; the State Store independently rejects control mutation bodies above 16 KiB. Both enforce declared `Content-Length` and count streamed bytes before JSON parsing. Targeted tests cover oversized declared bodies, oversized chunked bodies, malformed JSON, and unchanged control state after rejection. These limits reduce memory/parse exposure but do not replace ingress rate limiting or slow-client protection.
- **Rate limiting:** persistent limit is per configured actor; because the actor is static, it is not a per-human limit. There is no separate global ingress limit, and read routes are not rate-limited.
- **Audit semantics:** the audit table records state-changing pause/resume events. Idempotent no-op requests and rejected attempts are not represented as completed state-change audit rows. Add access-controlled security-event logging if operational attribution requires those events.
- **Resume assurance:** current route checks the bearer and configured actor but does not independently verify account plan, resource health, or an approval confirmation.
- **Deployment:** no Durable Object namespace, binding, or Preview secrets are configured. The bridge is therefore not live.

## Required acceptance gates

1. Verify a no-cost identity/session option and actual account entitlement; no paid upgrade, billing activation, or payment setup.
2. Threat-model operator compromise, replay, token theft, session theft, rate-limit bypass, and internal-token exfiltration.
3. Preserve the implemented 1 KiB Worker and 16 KiB State Store control-body caps; keep regression coverage for declared-length, streamed, and malformed-body rejection.
4. Implement named human identity, MFA, short sessions, revocation, least-privilege roles, and appropriate browser CSRF/Origin protections before any browser-based administration.
5. Add global ingress protection and decide how rejected/no-op control attempts are recorded without leaking secrets.
6. Preserve transactional pause behavior and verify concurrent reserve/claim calls cannot pass the persisted pause state.
7. Verify resume does not dispatch queued tasks and pause does not falsely claim to stop already-running side effects.
8. Confirm the audit trail does not contain credentials, cookies, task payloads, or sensitive personal data.
9. Verify Free plan and actual usage headroom before creating any namespace, binding, secret, or deployed control-plane resource.
10. Run targeted tests and isolated Preview smoke only after the above prerequisites; preserve the Draft PR and do not merge as part of this ADR update.

## Rollback and explicit non-goals

- Keep `AGENT_ENABLED=false` and `AGENT_PAUSED=true` by default.
- Rollback remains an isolated Preview code/config revert; do not delete or mutate Production resources.
- No public admin dashboard, direct browser-to-Durable-Object call, task handler, external side effect, scheduler, alarm, cron, automatic recovery, or 24/7 execution is authorized here.
- No changes to Production Worker, DNS, D1, secrets, routes, live user data, billing, or paid settings.
