# AI Thực Chiến — 24/7 Agent Runtime (Preview only)

This directory is a separate Cloudflare Worker service. It is not imported by the public website Worker and has no Production route, website D1 binding, AI binding, secrets, or social integrations. The only deploy workflow is a separate manually confirmed Preview-only workflow using `wrangler.preview.jsonc`; there is no automatic deploy.

## Runtime foundation

- A Cloudflare Workflow binding is present for orchestration. Both `wrangler.jsonc` and `wrangler.preview.jsonc` are unscheduled; the Preview configuration is manual-only and defines no recurring Workflow trigger. The runtime remains disabled and paused. A deterministic human-authoring scaffold executor is registered, but it is not active while the pause flags are set; external provider adapters, quota verification, semantic claim verification, owner release, and publication gates remain incomplete.
- A separate SQLite-backed Durable Object provides a durable task queue. It is not the website's D1 database.
- Queue contracts include an allowlist of task types, per-agent payload schemas, an 8 KiB payload ceiling, idempotent task IDs, a 500-task active-queue ceiling, five-minute leases with unique fencing tokens, a five-attempt ceiling, bounded retry backoff (30 seconds, 2 minutes, 10 minutes, then 30 minutes), a dead-letter state, and rejection of stale worker completion. Failed or expired attempts are not claimable until their persisted `available_at` time; legacy rows are migrated with an immediately eligible default.
- Queue operations are internal Durable Object RPC methods only. There is no public task-enqueue endpoint.
- The supervisor code supports an idempotent `runtime_health_check` only when explicitly invoked in an enabled isolated environment. The Preview configuration has no recurring schedule. If invoked manually in an isolated enabled environment, the supervisor still requires `AGENT_ENABLED=true` and `AGENT_PAUSED` not true before queue access, network requests, or task execution.
- Once per UTC day, the supervisor enqueues an idempotent `ai_bank_discovery` task. Its only handler fetches ten hard-coded public GitHub Atom release feeds over HTTPS using GET, rejects redirects, applies a 10-second per-source timeout and a 1 MB response ceiling, validates release URLs against the exact repository, and stores at most five sanitized recent signals in the task result.
- The same daily cycle enqueues one idempotent `content_research` task for the fixed topic `AI agents, automation, and open-source AI tools`. Its discovery handler reads four fixed public feeds: OpenAI News, Google DeepMind, Hugging Face, and arXiv cs.AI. It uses GET only, rejects redirects, applies an 8-second timeout and a 750 KB response ceiling per feed, validates HTTPS host and path, and stores at most four recent source signals. 
- After discovery, the runtime retrieves at most four original source pages from the exact HTTPS host/path allowlist. It rejects redirects, non-HTML content, off-domain/final URLs, applies a six-second timeout and 120 KB streaming body ceiling per page, strips active/noisy markup, and stores only a text excerpt of at most 600 characters with source URL, source name, publication timestamp, and retrieval timestamp. Raw HTML is never stored.
- Every outbound GET passes through a persistent SQLite Durable Object budget before the network call. The UTC-day budget is limited to ten attempts for the ten AI Bank feeds and eight attempts for the four research feeds plus at most four evidence pages. Attempts are counted before calling fetch, including requests that later fail or time out; retries share the same daily counters, and exhausted budgets reject further requests before network access. When a task reaches the daily budget ceiling, that daily task is moved directly to dead-letter rather than being retried repeatedly during the same UTC day; the next UTC day receives a new idempotent daily task. Budget counters are isolated by task scope and UTC day, with only the most recent 30 days retained. This caps the current runtime's intended daily outbound attempts at 18 across retries; it is a code-level ceiling, not a statement about Cloudflare account billing or quota.
- Retrieved excerpts are labeled `source_retrieved_not_fact_checked`. A deterministic evidence-readiness assessment accepts at most four excerpts and requires at least two distinct publisher domains with valid publication dates no older than 45 days. It additionally requires an exact publisher-label, host, and path match against the four fixed discovery sources (OpenAI News, Google DeepMind, Hugging Face, and arXiv cs.AI). Duplicate URLs/domains, unknown or mismatched publisher identities, missing metadata, stale/future dates, and failed retrievals are excluded. This allowlist establishes provenance consistency only; it does not endorse source authority or verify independent ownership.
- `evidence_packet_ready_for_claim_review` means only that the packet has enough recent, distinct-domain source records to enter claim review. It does not prove that sources independently support the same claim, assess source authority, extract claims, or fact-check/corroborate anything. No article drafting or publication is authorized by this status.
- A claim-evidence provenance ledger accepts explicitly supplied factual claims and links each one only to retrieved excerpts already accepted by the readiness assessment. It requires two distinct publisher domains per claim, caps the batch at 40 claims and four evidence references per claim, and flags missing or untraceable mappings.
- `traceable_evidence_pending_human_review` means only that source provenance is traceable. The ledger does not evaluate whether excerpts semantically support claims, whether sources are truly independent, or whether claims are accurate. All claims remain pending human review; publication is never authorized.
- A standalone human-review record accepts exactly one explicit decision (`supported`, `unsupported`, or `needs_revision`) for every claim in a complete traceable batch. It requires a reviewer reference, canonical review timestamp, and a meaningful note for each decision. It snapshots each exact claim and its cited excerpts with a SHA-256 fingerprint, and separately fingerprints the decision, reviewer note, reviewer reference, timestamp, and evidence URL order so later record edits can be detected. The decision records the reviewer's judgment only; even `supported` does not establish truth or authorize release. This module is not exposed through an endpoint and is not yet connected to a public draft or publishing workflow.
- A separate review-record verifier recomputes each SHA-256 fingerprint against the current ledger and checks that claim text, evidence URL order, reviewer metadata, decisions, reviewer notes, and non-publication safety flags still match. It detects snapshot changes but does not authenticate reviewer identity or establish truth; it never grants publication authority.
- A standalone deterministic article quality gate checks Vietnamese language marker, DUNG - AI attribution, SEO title/description lengths, minimum article length and section count, three distinct HTTPS references, inline citation indexes, copyright notice, and unsafe active markup. It returns `eligible_for_human_review` or `needs_revision`; it always sets `publication_authorized: false`.
- A standalone article evidence-readiness gate accepts an explicit article claim manifest, verifies the human-review record against the source ledger, requires every included claim to match the exact reviewed claim text, requires a `supported` decision, and requires the exact reviewed evidence URL order. Each claim must also declare unique inline citation indices in the exact same order as its reviewed evidence URLs; the gate binds those indices to the article bibliography positions and requires the corresponding citation markers in the body. It then runs the independent article structure gate. A passing result is only `eligible_for_owner_release_review`; it does not discover omitted claims in the prose, independently fact-check claims, prove semantic support, clear copyright, or authorize publication/social posting.
- The isolated draft Durable Object accepts a bounded optional claim manifest and can persist a verified evidence ledger, human-review record, and article evidence-readiness result using optimistic version checks. It exposes only internal RPC methods, no HTTP review/approval endpoint. Any article revision clears the stored evidence review so stale decisions cannot carry forward. `eligible_for_owner_release_review` is a queue status only; there is no release, publish, or social-post method.
- The quality gate is a structural pre-check only. It does not establish truth, originality, source reliability, license compatibility, copyright ownership, or publishability, and does not authorize publication.
- Discovery is read-only. Release signals are not verified AI Bank records; no pricing, free quota, license, privacy, regional availability, or product suitability is inferred. There is no catalog write, public content write, or publication step.
- The supervisor processes at most five bounded tasks per cycle (one health task, one AI Bank release scan, one research-source scan, one internal human-authoring scaffold task, and one deterministic article quality-review task). It makes no model calls and does not access private GitHub data.
- `content_research` is currently limited to the fixed daily read-only discovery and bounded source-evidence retrieval described above; it is not free-form topic research. `content_draft` is now registered only for creating an internal human-authoring scaffold from the same-cycle research result; `quality_review` is now registered for article artifacts only. It re-runs the deterministic article structure/safety gate against the exact stored artifact version, persists the review snapshot, and keeps the artifact in either `needs_revision` or `pending_human_review`. AI-tool quality review is still rejected.
- Completed task results are stored in the isolated queue database with an 8 KiB ceiling. Every enabled supervisor cycle prunes at most 100 eligible terminal tasks total (completed tasks older than 24 hours and dead-letter tasks older than seven days) and at most 100 request-budget counters older than 30 UTC days. Additional expired rows are retained for a later cycle. Pending and leased tasks are never removed by this retention pass.
- `GET /health` exposes service metadata only. No personal data, credentials, or website data are stored or transmitted by the current code.


### Google reviewer OAuth and authenticated review console (Preview foundation only)

- `src/google-reviewer-oauth.mjs` implements the Google authorization-code callback flow. It generates cryptographically random state, nonce, browser binding, and PKCE verifier; stores a short-lived, single-use transaction in the dedicated `AgentReviewerAuthStore` Durable Object; and binds the callback to the browser transaction cookie.
- The callback exchanges the authorization code server-side using HTTPS POST, redirect rejection, and an eight-second timeout. Google token JSON is capped at 32 KiB; the JWKS response used for ID-token verification is capped at 64 KiB while streaming.
- `src/google-oidc-reviewer-verifier.mjs` accepts RS256 only and checks Google's issuer, audience/authorized party, signature, key ID, expiry, issue time, optional not-before time, nonce, verified email, and the configured reviewer email allowlist.
- A successful identity check creates a signed HMAC session with a 30-minute lifetime. Session and transaction cookies use the `__Host-` prefix, Secure, HttpOnly, Path=/, and SameSite=Lax. Logout clears both cookies. No ID token or reviewer identity is accepted from a request body.
- OAuth configuration is accepted only when the redirect URI is HTTPS and points to the exact `ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev/auth/google/callback` hostname/path. Production website Worker callback URLs are rejected by the code.
- Google reviewer login starts are rate-limited by the dedicated auth Durable Object to 10 attempts per fixed 60-second window. The 11th attempt receives HTTP 429 with `Retry-After`; this is an abuse-control limit, not a provider quota or proof of Cloudflare billing limits.
- `wrangler.preview.jsonc` defines the isolated `AgentReviewerAuthStore` Durable Object and its SQLite migration. Both runtime configs keep `AGENT_REVIEWER_AUTH_ENABLED=false`; the Preview deploy workflow requires a manually confirmed dispatch and a dedicated Preview token.
- `GET /reviewer-console` serves the reviewer UI. Authenticated `GET /api/reviewer/drafts` and `GET /api/reviewer/drafts/:id` return bounded queue metadata and selected draft details only after the Durable Object independently validates the signed session. The UI renders Markdown as text and is read-only.
- The evidence-review recording endpoint is a separate authenticated API contract, but the current console does not submit decisions. Reviewer identity does not grant owner release approval, publication authorization, deployment permissions, or Facebook publishing.
- Tests use local ephemeral RSA keys, mocked token/JWKS responses, and a fake transaction store. They do not use real Google credentials or contact Google.
- This is implemented code with unit and contract coverage, not an operational login service: no Google OAuth client, real Preview redirect registration, client secret, session secret, or reviewer allowlist has been configured or verified. Therefore OAuth remains disabled and reviewer data endpoints remain inaccessible until a separate Preview-only configuration and end-to-end test are completed.
- Before enabling OAuth, verify the exact Preview hostname, register only that callback URI in a dedicated Google OAuth client, configure the secrets and one authorized reviewer email in Preview-only secret storage, then test login, callback, logout, session expiry, queue reads, and denial of unauthorized accounts with a separate test account. Do not reuse Production credentials or expose secrets in logs or repository files.
- Identity authentication remains separate from human evidence review, owner release approval, publication, deployment, and social posting. All publication flags remain false.

## Explicit enable gate and emergency pause

- `AGENT_ENABLED` must be exactly `true` before the supervisor can access the Durable Object queue or make any outbound request. Missing, empty, or any other value leaves the runtime disabled.
- The default Wrangler config remains unscheduled with `AGENT_ENABLED=false`, `AGENT_PAUSED=true`, and `AGENT_SCHEDULE_MODE=manual_only_no_cron`. The isolated Preview config is also unscheduled and retains `AGENT_ENABLED=false` and `AGENT_PAUSED=true`; no recurring Workflow instances are created. Manual invocation remains disabled by the pause flags.
- `AGENT_PAUSED=true` is an independent emergency stop and takes precedence even when `AGENT_ENABLED=true`.
- `GET /health` reports the explicit enable state, the durable circuit-breaker state, and the daily task-admission counter; task execution remains disabled unless the enable flag is exactly true and the pause flag is not true.
- Do not enable the service until Preview resource boundaries, current free-tier usage, provider quotas, monitoring, and the deployment plan have been reviewed. Neither switch is connected to the public website Worker. No Production configuration is changed by this PR.

### Authenticated operator control plane (Preview candidate; disabled by default)

- `POST /api/operator/runtime-control` supports only `pause` and `resume`; `GET` returns the durable pause state. Both operations require the Google reviewer session cookie and are independently re-verified inside the Task Store Durable Object.
- Operator authorization is a separate exact-email allowlist: `AGENT_OPERATOR_ALLOWED_EMAILS` must contain exactly one email, and that identity must also be in the Google reviewer allowlist. The operator control feature is disabled unless `AGENT_OPERATOR_CONTROL_ENABLED=true`. Both flags remain false in checked-in Wrangler configs; the allowlist must be configured only in Preview secret storage after OAuth setup.
- Mutating requests require the exact same-origin `Origin`, JSON content type, a bounded 2 KiB body, an explicit `pause` or `resume` action, and a meaningful reason. The Durable Object records actor reference, reason, previous state, action, and timestamp in the bounded audit table.
- Invalid sessions, non-operator reviewers, missing allowlists, disabled control, malformed requests, and cross-origin requests fail closed. No operator email or session token is accepted from the request body.
- An operator resume changes only the durable Task Store circuit-breaker pause. It does not override `AGENT_ENABLED=false` or `AGENT_PAUSED=true`; deployment-level disable/pause flags remain authoritative. The circuit breaker never auto-resumes.
- `/operator-console` serves a same-origin operator UI with explicit pause/resume confirmation, a mandatory reason, and read-only runtime/admission status. It uses a separate external script, restrictive CSP, `textContent` rendering, and same-origin fetches; it exposes no publishing or deployment actions.
- This is a Preview code candidate, not a deployed operator dashboard. No credentials, allowlist, or live login are configured; end-to-end operator authentication remains a Preview release gate.

## Free-tier guardrails

Cloudflare publishes plan-specific limits and pricing for Workflows and SQLite-backed Durable Objects. Exact remaining quota depends on the account and its other workloads; this repository does not have verified access to the account's current usage. Do not assume the service is free at any scale. Before Preview deployment, confirm the account's current free-tier limits and usage in the dashboard. The runtime must fail closed at its configured queue ceiling; no paid plan or billing change is authorized.

## Validation and deployment

Run from this directory with a current Wrangler 4 release:

```sh
npx wrangler types --config wrangler.jsonc
npx wrangler deploy --dry-run --config wrangler.jsonc
```

Do not deploy from this branch until the separate Preview account/resource boundary, free-tier quota, and Workflow schedule are verified. There is no automatic CI deploy job; the separate Preview deploy workflow requires an explicit manual confirmation. A Durable Object migration is a resource change and must be reviewed before any Preview deployment.

## Next gated phases

1. Exercise queue behavior against a local Durable Object emulator: idempotency, concurrent claims, lease expiry, retry and dead-letter behavior.
2. Connect the supervisor to the queue while retaining a strict task-type allowlist.
3. Add read-only GitHub/public-source adapters with bounded timeouts and rate limits.
4. Add model execution only after verifying a genuinely no-cost quota; otherwise remain in deterministic planning mode.
5. Connect the deterministic article quality gate to a controlled draft artifact store and human-review queue after research and drafting specialists are implemented.
6. Complete Preview-only end-to-end verification of the authenticated operator control API, monitoring, alerting and pause/resume controls.
7. Consider public actions only through the existing owner approval gates.

The Preview configuration is manual-only and installs no recurring Workflow schedule. It is not autonomous task execution. Do not enable task execution or introduce a schedule until the account's free-tier plan and current usage, monitoring, and emergency-pause behavior are verified. Quota exhaustion must fail closed rather than enable billing.


### Google reviewer OAuth and session flow (Preview foundation only)

- The Preview config binds a dedicated SQLite Durable Object transaction store. Each login transaction records only a SHA-256 state hash, browser-binding hash, nonce, PKCE verifier, and five-minute expiry. The store consumes a transaction once; a missing, expired, mismatched, or replayed transaction is rejected.
- `GET /auth/google/start` is available only when `AGENT_REVIEWER_AUTH_ENABLED=true` and all private runtime configuration is present. It generates cryptographically random state, nonce, browser binding, and PKCE verifier; stores the transaction server-side; and redirects to Google's authorization-code endpoint using S256 PKCE. The browser binding is carried in a signed Secure, HttpOnly, SameSite=Lax, host-only cookie.
- `GET /auth/google/callback` requires the exact configured HTTPS callback origin and path, verifies the signed browser cookie, consumes the transaction before exchanging the code, sends the PKCE verifier and client secret only from the server, then verifies the returned Google ID token with the separate OIDC verifier. OAuth errors, invalid tokens, and replayed transactions fail closed.
- A successful identity check creates a separate 30-minute HMAC-signed Secure, HttpOnly, SameSite=Lax, host-only session cookie. `GET /auth/google/me` reports the authenticated Google subject and allowlisted email; `GET /auth/google/logout` clears both cookies. Session identity is derived from Google's immutable `sub`, never from request parameters.
- Private Preview configuration required before a real login: `GOOGLE_REVIEWER_CLIENT_ID`, `GOOGLE_REVIEWER_CLIENT_SECRET`, `GOOGLE_REVIEWER_REDIRECT_URI`, `GOOGLE_REVIEWER_ALLOWED_EMAILS`, `GOOGLE_REVIEWER_STATE_SECRET`, and `GOOGLE_REVIEWER_SESSION_SECRET`. Secrets must be configured through the Cloudflare Preview secret interface; never commit or paste them into source control or chat. Both HMAC secrets must be independently generated random values of at least 32 characters. The callback URI must exactly match the Preview Worker hostname and `/auth/google/callback`.
- The Cloudflare account's read-only Workers subdomain lookup returned `manhdungub`. Once the Preview Worker is deliberately deployed, register this exact Google OAuth authorized redirect URI: `https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev/auth/google/callback`. Do not register the production website Worker or any wildcard callback. The OAuth client must be a Web application client; only the explicitly allowlisted reviewer account should be permitted to complete the consent/test-user flow.
- `AGENT_REVIEWER_AUTH_ENABLED` is explicitly `false` in the Preview config. No OAuth client, credentials, allowlist, HMAC secrets, or live Google login have been configured or tested. The code is not deployed. This is a tested Preview-only implementation candidate, not an active login service.
- Authentication does not approve articles, prove factual accuracy, authorize publication, permit Production deployment, or enable Facebook posting. The owner-release and publication gates remain separate and fail-closed. No Production configuration, website Worker, DNS, D1, or social account is changed.


### Authenticated reviewer evidence-review boundary

- The Worker routes `GET /auth/google/start`, `GET /auth/google/callback`, `GET /auth/google/me`, and `GET /auth/google/logout` through the Preview-only Google OAuth handler.
- The authenticated review write route is `POST /api/reviewer/drafts/:id/evidence-review`. It requires a same-origin `Origin` header, JSON content type, bounded request body, and the signed HttpOnly Google reviewer session cookie. Cross-origin form submissions and requests without a session are rejected.
- The Durable Object independently validates the HMAC session token against private runtime configuration, checks expiry, the single-email allowlist, and the immutable Google subject-derived reviewer reference. The request cannot submit an `authenticatedReviewer` flag or replace the verified principal.
- The persisted review record's `reviewer_ref` must exactly match the server-verified session principal. A mismatched or absent identity never passes the identity gate. Evidence review writes are rejected when reviewer authentication is disabled or the session is invalid.
- A matching authenticated review may become `eligible_for_owner_release_review` only. It does not authorize publication, website deployment, AI Bank catalog writes, or Facebook/social posting. The owner release decision and all publication/deployment gates remain separate.
- Preview config keeps `AGENT_REVIEWER_AUTH_ENABLED=false`; no credentials or live Google login are configured. The new route and Durable Object binding have not been deployed. Tests use local fixtures/mocks only.


### Claim-ledger publisher provenance enforcement

- The claim ledger independently re-checks each supplied evidence item's exact publisher label, HTTPS host, and article path against the fixed research publisher policy. It does not rely solely on an upstream assessment's `accepted_sources` list.
- Evidence from unknown domains or mismatched publisher labels is excluded before claim-to-source mapping. A claim cannot reach the traceable state by supplying a forged assessment object or by relabeling another publisher's URL.
- Distinct publisher count is a provenance count only. It does not prove independent ownership, semantic entailment, factual truth, or that the excerpt supports the claim.
- All claims remain pending human review. No drafting, AI inference, catalog write, public publishing, deployment, or social posting is enabled by this check.


### Source-by-source human evidence review

- A reviewer must now record a separate decision for every cited source attached to every claim: `supports`, `contradicts`, or `insufficient`, with a meaningful note and an exact source URL match.
- A claim cannot be marked `supported` unless every mapped source has an explicit `supports` decision. Missing, reordered, mismatched, or contradictory source assessments cannot pass as supported.
- The review fingerprint covers the per-source decisions and notes; the verifier rechecks them against the exact ledger source order and revalidates publisher label/host/path provenance.
- This makes the review auditable but does not independently prove that the reviewer's judgment is correct. Authenticated reviewer identity, owner release approval, copyright/originality checks, and publication authorization remain separate gates.



### Read-only reviewer console (Preview candidate)

- `GET /reviewer-console` serves a static same-origin interface for Google reviewer sign-in, bounded queue browsing, and opening a selected draft.
- `GET /reviewer-console.js` serves the console client as a separate same-origin script so the HTML can enforce a restrictive Content Security Policy without inline JavaScript.
- The console reads only `/auth/google/me`, `GET /api/reviewer/drafts?limit=20`, and `GET /api/reviewer/drafts/:id`. It does not submit evidence decisions, edit drafts, approve owner release, publish content, or post to social networks.
- Draft Markdown, review metadata, and evidence packets are inserted into the page as text using DOM `textContent`; no Markdown/HTML rendering or `innerHTML` sink is used. Source links are accepted only for HTTPS and open with `noopener noreferrer`.
- The HTML response sets a restrictive CSP (`default-src 'none'`, same-origin script/connect, no framing, no base URI, same-origin form actions), plus no-store, nosniff, frame denial, and no-referrer headers. The JavaScript response is also no-store and nosniff.
- This is a Preview-only candidate. The reviewer OAuth allowlist and secrets are not configured, `AGENT_REVIEWER_AUTH_ENABLED=false`, and the console has not been deployed. It cannot display private drafts until the authenticated Preview path is separately configured and tested.
- The console is intentionally read-only. Evidence decisions, owner release review, publication, and deployment remain separate gated workflows.


#### Evidence review prerequisite

The reviewer console deliberately does not offer a decision form based only on a draft's claim manifest or source URLs. A reviewer must be able to inspect the actual source excerpts captured in a traceable evidence ledger. If `artifact.evidence_review.ledger.claims` is absent, the console displays an explicit blocked state and explains that URLs/claim mappings are not source evidence. The next integration step is to persist and expose the immutable research ledger with the draft before any claim-level decision UI is enabled.


### Human claim evidence-ledger builder

- `buildHumanClaimReviewLedger(claims, retrievedEvidence)` binds only explicitly human-authored claim text and claim IDs to exact excerpts already returned by the bounded research retrieval module.
- Each claim must map to 2–4 retrieved excerpts from distinct allowlisted publisher hosts. URLs must match the retrieved evidence exactly; missing, duplicate, unallowlisted, failed, or too-short evidence is rejected.
- The builder does not generate claims, infer semantic support, or create review decisions. Every claim remains `traceable_evidence_pending_human_review`, and the ledger explicitly requires human review.
- This module is a deterministic building block only. It is not yet connected to durable draft storage or the reviewer console; do not treat a generated ledger as attached to a draft until that persistence path is implemented and tested.
- Publication, catalog mutation, draft creation, and social posting remain unauthorized.


### Version-bound evidence ledger persistence

- The Durable Object exposes an internal `storeEvidenceLedger(id, expectedVersion, retrievedEvidence)` method for the trusted Worker research path; it is not exposed as a public HTTP route.
- It derives the ledger only from the stored draft's exact claim manifest and the bounded retrieved-excerpt objects, then stores the ledger with the draft version it was built from.
- A ledger is visible to the authenticated reviewer as a pending evidence packet; it is not a review decision and cannot authorize release.
- A draft revision clears the ledger, review record, and readiness result. The final evidence-review write must match the previously stored ledger snapshot and its version.
- The current runtime still has no content-draft executor that connects Research Agent output to this store method. This PR adds the durable, version-checked persistence boundary; it does not claim an end-to-end autonomous writing pipeline.


### Research-to-draft evidence preparation

- `prepareDraftEvidenceLedger({ draftStore, artifactId, fetchImpl, now })` is a bounded orchestration helper for an existing draft with an explicit human-authored claim manifest.
- It reads the stored draft, resolves only exact URLs already present in that draft's source manifest, and retrieves at most four unique source pages through the supplied fetch implementation.
- The caller must provide the runtime's budget-enforcing `fetchImpl`; the helper has no unbudgeted network fallback.
- If any source fails retrieval, a claim references a URL outside the draft manifest, the draft is not eligible, or the ledger already exists, no ledger write is attempted.
- A complete retrieval is persisted through the version-checked Durable Object method using the draft version read at the start. Stale writes remain blocked.
- This helper is not yet called by the supervisor because there is still no content-draft executor or approved draft-creation workflow. It is a tested Research → evidence-persistence building block, not proof of autonomous article production.
- All excerpts remain `source_retrieved_not_fact_checked`; the helper does not create claims, assess semantic support, authorize release, publish content, or post to social networks.


### Human article-authoring brief boundary

- `buildArticleAuthoringBrief({ topic, researchEvidence })` creates a Vietnamese editorial scaffold only when at least three distinct source URLs pass the fixed publisher-label/host/path policy and carry successful retrieval metadata.
- It does not copy source excerpts into article prose, generate factual claims, or create a stored draft. Every article section remains an explicit human-authoring placeholder.
- The deterministic article quality gate is run against the scaffold and is expected to return `needs_revision`; this is intentional and is not a publication-ready article.
- The helper is invoked by the bounded `content_draft` task only to persist an internal authoring scaffold; no complete article is generated.


### Supervisor research-to-authoring handoff

- The bounded supervisor now registers `content_draft` as an executable task, but its scope is deliberately limited to creating a human-authoring scaffold from the completed same-cycle `content_research` result.
- The task uses only successfully retrieved evidence from the research task, requires three distinct publisher-policy-approved sources, and stores the resulting scaffold in the isolated `AGENT_DRAFT_STORE` under a stable daily artifact ID.
- The scaffold is expected to remain `needs_revision` and is excluded from the pending human-review queue. It contains no generated factual claims and is not a complete article.
- The task performs no additional network calls, AI inference, public API writes, publication, or social actions. The runtime remains disabled and paused in both checked-in configs; this executor does not activate the supervisor.
- `quality_review` is registered only for article artifacts. It re-runs the deterministic structural/safety gate through an internal, version-checked Draft Store RPC; no public task-enqueue or quality-review endpoint is added. The task makes zero external calls and cannot write article content, create a human review decision, approve owner release, or authorize publication.


### Google reviewer identity upstream response limits

- The Google OAuth token exchange response is parsed as JSON with a strict 32 KiB streamed-byte ceiling; the Google OIDC JWKS response has a 64 KiB ceiling.
- Both limits are enforced while reading the response stream, not only from the untrusted `Content-Length` header. Non-JSON content types, missing bodies, invalid UTF-8, malformed JSON, and oversized bodies fail closed.
- This does not enable reviewer OAuth, configure credentials, create a Google client, or make any live Google request during tests. The reviewer authentication feature remains disabled until an isolated Preview deployment and explicit secret configuration are separately approved.


### Preview-only Workflow scheduling (disabled)

- Both the default `wrangler.jsonc` and isolated `wrangler.preview.jsonc` omit the Cloudflare Workflows `schedules` property. No cron or recurring invocation is installed.
- Preview keeps `AGENT_ENABLED=false`, `AGENT_PAUSED=true`, and `AGENT_SCHEDULE_MODE=manual_only_no_cron`. No recurring Workflow invocation is configured; any future manual invocation still checks these flags before `step.do`, queue access, network requests, or task execution and returns `paused` with zero tasks and zero external calls.
- This is manual-only orchestration configuration, not an active autonomous Agent. It does not create scheduled Workflow instances. Account tier and remaining usage still must be checked before any Preview deployment or execution.
- Preview deployment remains manual and requires the dedicated least-privilege `CLOUDFLARE_AGENT_PREVIEW_API_TOKEN`. No automatic deployment, recurring schedule, Production Worker, D1, DNS, OAuth secrets, AI inference, content publication, or social posting is enabled.


### Daily admission and circuit breaker

- Newly accepted task admission is capped at 100 per UTC day with a persisted counter. Idempotent duplicates do not consume the limit; the cap is independent of external request budgets and the 500-task active queue bound.
- Five terminal failures within a rolling ten-minute window durably auto-pause new admissions and claims. Non-terminal retries and expected external-request budget exhaustion do not count. The transition is audited and never auto-resumes.
- The authenticated operator resume route is not yet implemented on this Task Store branch, so the breaker remains fail-closed until a separately reviewed operator-control integration exists.
