# AI Thực Chiến — 24/7 Agent Runtime (Preview only)

This directory is a separate Cloudflare Worker service. It is not imported by the public website Worker and has no Production route, website D1 binding, AI binding, secrets, social integrations, or deploy workflow.

## Runtime foundation

- Cloudflare Workflows creates a recurring supervisor run every 15 minutes (UTC), with concurrency limited to one.
- A separate SQLite-backed Durable Object provides a durable task queue. It is not the website's D1 database.
- Queue contracts include an allowlist of task types, per-agent payload schemas, an 8 KiB payload ceiling, idempotent task IDs, a 500-task active-queue ceiling, five-minute leases with unique fencing tokens, a five-attempt ceiling, a dead-letter state, and rejection of stale worker completion.
- Queue operations are internal Durable Object RPC methods only. There is no public task-enqueue endpoint.
- The scheduled supervisor runs every 15 minutes, enqueues an idempotent `runtime_health_check`, claims only that task type and task ID, executes a deterministic local health check, and persists a bounded result.
- Once per UTC day, the supervisor enqueues an idempotent `ai_bank_discovery` task. Its only handler fetches ten hard-coded public GitHub Atom release feeds over HTTPS using GET, rejects redirects, applies a 10-second per-source timeout and a 1 MB response ceiling, validates release URLs against the exact repository, and stores at most five sanitized recent signals in the task result.
- The same daily cycle enqueues one idempotent `content_research` task for the fixed topic `AI agents, automation, and open-source AI tools`. Its discovery handler reads four fixed public feeds: OpenAI News, Google DeepMind, Hugging Face, and arXiv cs.AI. It uses GET only, rejects redirects, applies an 8-second timeout and a 750 KB response ceiling per feed, validates HTTPS host and path, and stores at most four recent source signals. 
- After discovery, the runtime retrieves at most four original source pages from the exact HTTPS host/path allowlist. It rejects redirects, non-HTML content, off-domain/final URLs, applies a six-second timeout and 120 KB streaming body ceiling per page, strips active/noisy markup, and stores only a text excerpt of at most 600 characters with source URL, source name, publication timestamp, and retrieval timestamp. Raw HTML is never stored.
- Retrieved excerpts are labeled `source_retrieved_not_fact_checked`. A deterministic evidence-readiness assessment accepts at most four excerpts and requires at least two distinct publisher domains with valid publication dates no older than 45 days. Duplicate URLs/domains, missing metadata, stale/future dates, and failed retrievals are excluded.
- `evidence_packet_ready_for_claim_review` means only that the packet has enough recent, distinct-domain source records to enter claim review. It does not prove that sources independently support the same claim, assess source authority, extract claims, or fact-check/corroborate anything. No article drafting or publication is authorized by this status.
- A claim-evidence provenance ledger accepts explicitly supplied factual claims and links each one only to retrieved excerpts already accepted by the readiness assessment. It requires two distinct publisher domains per claim, caps the batch at 40 claims and four evidence references per claim, and flags missing or untraceable mappings.
- `traceable_evidence_pending_human_review` means only that source provenance is traceable. The ledger does not evaluate whether excerpts semantically support claims, whether sources are truly independent, or whether claims are accurate. All claims remain pending human review; publication is never authorized.
- A standalone human-review record accepts exactly one explicit decision (`supported`, `unsupported`, or `needs_revision`) for every claim in a complete traceable batch. It requires a reviewer reference, canonical review timestamp, and a meaningful note for each decision. It snapshots each exact claim and its cited excerpts with a SHA-256 fingerprint, and separately fingerprints the decision, reviewer note, reviewer reference, timestamp, and evidence URL order so later record edits can be detected. The decision records the reviewer's judgment only; even `supported` does not establish truth or authorize release. This module is not exposed through an endpoint and is not yet connected to a public draft or publishing workflow.
- A separate review-record verifier recomputes each SHA-256 fingerprint against the current ledger and checks that claim text, evidence URL order, reviewer metadata, decisions, reviewer notes, and non-publication safety flags still match. It detects snapshot changes but does not authenticate reviewer identity or establish truth; it never grants publication authority.
- A standalone deterministic article quality gate checks Vietnamese language marker, DUNG - AI attribution, SEO title/description lengths, minimum article length and section count, three distinct HTTPS references, inline citation indexes, copyright notice, and unsafe active markup. It returns `eligible_for_human_review` or `needs_revision`; it always sets `publication_authorized: false`.
- A standalone article evidence-readiness gate accepts an explicit article claim manifest, verifies the human-review record against the source ledger, requires every included claim to match the exact reviewed claim text, requires a `supported` decision, and requires the exact reviewed evidence URL order. It then runs the independent article structure gate. A passing result is only `eligible_for_owner_release_review`; it does not discover omitted claims in the prose, independently fact-check claims, clear copyright, or authorize publication/social posting.
- The quality gate is a structural pre-check only. It does not establish truth, originality, source reliability, license compatibility, copyright ownership, or publishability, and is not yet connected to an autonomous draft executor.
- Discovery is read-only. Release signals are not verified AI Bank records; no pricing, free quota, license, privacy, regional availability, or product suitability is inferred. There is no catalog write, public content write, or publication step.
- The supervisor processes at most three tasks per cycle (one health task, one AI Bank release scan, and one research-source scan). It makes no model calls and does not access private GitHub data.
- `content_research` is currently limited to the fixed daily read-only discovery and bounded source-evidence retrieval described above; it is not free-form topic research. `content_draft` and `quality_review` remain queued task contracts without registered executors and are not claimed by the supervisor.
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
5. Connect the deterministic article quality gate to a controlled draft artifact store and human-review queue after research and drafting specialists are implemented.
6. Add an authenticated operator control plane, monitoring, alerting and a pause switch.
7. Consider public actions only through the existing owner approval gates.

A scheduled Workflow is a recurring background service, not a guarantee of uninterrupted model inference. Account limits, platform incidents, and quota exhaustion can pause work; the runtime must fail closed rather than enable billing.
