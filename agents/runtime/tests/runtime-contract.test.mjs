import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
const store = await readFile(new URL("../src/task-store.mjs", import.meta.url), "utf8");
const research = await readFile(new URL("../src/research-discovery.mjs", import.meta.url), "utf8");
const evidence = await readFile(new URL("../src/research-evidence.mjs", import.meta.url), "utf8");
const evidenceAssessment = await readFile(new URL("../src/research-evidence-assessment.mjs", import.meta.url), "utf8");
const articleGate = await readFile(new URL("../src/article-quality-gate.mjs", import.meta.url), "utf8");
const candidateStore = await readFile(new URL("../src/ai-bank-candidate-store.mjs", import.meta.url), "utf8");

test("runtime uses a recurring Workflow schedule with single-instance concurrency", () => {
  assert.equal(config.workflows.length, 1);
  assert.deepEqual(config.workflows[0].schedules, ["*/15 * * * *"]);
  assert.equal(config.workflows[0].concurrency.limit, 1);
});

test("runtime has isolated SQLite storage and no website Production bindings", () => {
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.vars, { AGENT_ENABLED: "false", AGENT_PAUSED: "false" });
  assert.equal(config.routes, undefined);
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.ai, undefined);
  assert.match(config.name, /preview$/);
  assert.deepEqual(config.durable_objects.bindings, [
    { name: "AGENT_TASK_STORE", class_name: "AgentTaskStore" },
    { name: "AGENT_DRAFT_STORE", class_name: "AgentDraftStore" },
    { name: "AGENT_AI_BANK_CANDIDATE_STORE", class_name: "AgentAIBankCandidateStore" }
  ]);
  assert.deepEqual(config.migrations, [
    { tag: "v1-agent-task-store", new_sqlite_classes: ["AgentTaskStore"] },
    { tag: "v2-agent-draft-store", new_sqlite_classes: ["AgentDraftStore"] },
    { tag: "v3-ai-bank-candidate-store", new_sqlite_classes: ["AgentAIBankCandidateStore"] }
  ]);
});

test("health endpoint is read-only and does not expose task enqueue", () => {
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /task_execution_enabled: env.AGENT_ENABLED === "true" && env.AGENT_PAUSED !== "true"/);
  assert.match(source, /task_enqueue_endpoint_enabled: false/);
  assert.match(source, /production_access: false/);
  assert.match(source, /AGENT_PAUSED/);
  assert.match(source, /AGENT_ENABLED !== "true"/);
  assert.match(source, /status: this.env.AGENT_PAUSED === "true" \? "paused" : "disabled"/);
  assert.match(source, /queue_accessed: false/);
  assert.doesNotMatch(source, /fetch\(["']https?:/);
});

test("supervisor executes bounded health and daily read-only discovery tasks", () => {
  assert.match(source, /"runtime_health_check"/);
  assert.match(source, /store\.claim\(\[taskType\], taskId\)/);
  assert.match(source, /await store\.complete\(taskId, claimed\.lease_token, result\)/);
  assert.match(source, /discoverAiBankReleaseSignals/);
  assert.match(source, /discoverResearchSignals/);
  assert.match(source, /retrieveResearchEvidence/);
  assert.match(source, /evidence_retrieval/);
  assert.match(source, /research-scan-/);
  assert.match(source, /content_research/);
  assert.match(source, /ai-bank-scan-/);
  assert.match(source, /ai_bank_discovery/);
  assert.match(source, /catalog_modified: false/);
  assert.match(source, /AGENT_AI_BANK_CANDIDATE_STORE/);
  assert.match(source, /upsertCandidates/);
  assert.match(source, /ai_bank_candidate_store: candidateStore/);
  assert.match(source, /tasks_considered: 3/);
  assert.match(source, /external_calls: externalCalls/);
  assert.match(source, /production_access: false/);
});

test("task store enforces an allowlist, bounded payloads, and idempotent IDs", () => {
  assert.match(store, /TASK_TYPES\.has\(task\.task_type\)/);
  assert.match(store, /function validatePayload\(type, payload\)/);
  assert.match(store, /ai_bank_discovery: \["query"\]/);
  assert.match(store, /content_research: \["topic", "language"\]/);
  assert.match(store, /content_draft: \["topic", "research_task_id"\]/);
  assert.match(store, /quality_review: \["artifact_id", "artifact_type"\]/);
  assert.match(store, /runtime_health_check: \[\]/);
  assert.match(store, /MAX_PAYLOAD_BYTES = 8192/);
  assert.match(store, /result_json TEXT/);
  assert.match(store, /result_too_large/);
  assert.match(store, /INSERT OR IGNORE INTO tasks/);
  assert.match(store, /inserted\.rowsWritten === 0/);
  assert.match(store, /MAX_ACTIVE_TASKS = 500/);
  assert.match(store, /queue_capacity_reached/);
  assert.match(store, /id TEXT PRIMARY KEY/);
});

test("task store has bounded leases, retry ceiling, and dead-letter state", () => {
  assert.match(store, /MAX_ATTEMPTS = 5/);
  assert.match(store, /LEASE_MS = 5 \* 60 \* 1000/);
  assert.match(store, /status IN \('pending','leased','completed','dead'\)/);
  assert.match(store, /attempts >= \?/);
  assert.match(store, /lease_until > \?/);
  assert.match(store, /row\.lease_until <= now/);
  assert.match(store, /crypto\.randomUUID\(\)/);
  assert.match(store, /lease_token = \?/);
  assert.match(store, /row\.lease_token !== leaseToken/);
});

test("supervisor prunes terminal queue records with bounded retention on every cycle", () => {
  assert.match(store, /pruneTerminalTasks\(now = Date\.now\(\), limit = 100\)/);
  assert.match(store, /status = 'completed' AND updated_at < \?/);
  assert.match(store, /status = 'dead' AND updated_at < \?/);
  assert.match(store, /ORDER BY updated_at ASC/);
  assert.match(store, /LIMIT \?/);
  assert.match(store, /limit > 100/);
  assert.match(store, /24 \* 60 \* 60 \* 1000/);
  assert.match(store, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /await store\.pruneTerminalTasks\(\)/);
  assert.match(source, /retention,/);
});

test("outbound requests are counted atomically against persistent per-day source budgets", () => {
  assert.match(store, /external_request_budgets/);
  assert.match(store, /ai_bank_discovery: 10, content_research: 8/);
  assert.match(store, /ON CONFLICT \(budget_day, scope\) DO UPDATE/);
  assert.match(store, /daily_external_request_budget_exhausted/);
  assert.match(source, /createBudgetedFetch/);
  assert.match(source, /const budgetDay = scheduledAt\.slice\(0, 10\)/);
  assert.match(source, /createBudgetedFetch\(store, budgetDay, "ai_bank_discovery"\)/);
  assert.match(source, /createBudgetedFetch\(store, budgetDay, "content_research"\)/);
  assert.match(source, /consumeExternalRequestBudget\(day, scope\)/);
  assert.match(source, /external_calls: getExternalCalls\(\)/);
  assert.match(source, /external_calls: aiBankBudget\.count\(\)/);
  assert.match(source, /external_calls: researchBudget\.count\(\)/);
});

test("daily request-budget exhaustion terminalizes the current daily task without repeated retries", () => {
  assert.match(source, /errorCode === "daily_external_request_budget_exhausted"/);
  assert.match(source, /store\.abandon\(taskId, claimed\.lease_token, errorCode\)/);
  assert.match(store, /abandon\(taskId, leaseToken, errorCode = "non_retryable_task_failure"\)/);
  assert.match(store, /status = 'dead', lease_until = NULL, lease_token = NULL/);
});

test("completed and retried tasks release lease credentials and recheck expiry", () => {
  assert.match(store, /status = 'completed', lease_until = NULL, lease_token = NULL/);
  assert.match(store, /lease_until > \? AND lease_token = \?/);
  assert.match(store, /RETURNING id/);
  assert.match(store, /updated\.length === 1/);
});

test("idempotency keys cannot be reused for a different task payload", () => {
  assert.match(store, /existing\.task_type === task\.task_type/);
  assert.match(store, /existing\.payload_json === payloadJson/);
  assert.match(store, /idempotency_key_conflict/);
});

test("research discovery uses fixed official feeds and read-only bounded fetches", () => {
  assert.match(research, /https:\/\/openai\.com\/news\/rss\.xml/);
  assert.match(research, /https:\/\/deepmind\.google\/blog\/rss\.xml/);
  assert.match(research, /https:\/\/huggingface\.co\/blog\/feed\.xml/);
  assert.match(research, /https:\/\/rss\.arxiv\.org\/rss\/cs\.AI/);
  assert.match(research, /redirect: "error"/);
  assert.match(research, /MAX_BYTES = 750_000/);
  assert.match(research, /TIMEOUT_MS = 8_000/);
  assert.match(research, /content_created: false/);
});

test("research evidence retrieval is HTTPS allowlisted, bounded, and never publication-authorizing", () => {
  assert.match(evidence, /MAX_BODY_BYTES = 120_000/);
  assert.match(evidence, /MAX_EXCERPT_CHARS = 600/);
  assert.match(evidence, /MAX_EVIDENCE_ITEMS = 4/);
  assert.match(evidence, /TIMEOUT_MS = 6_000/);
  assert.match(evidence, /redirect: "error"/);
  assert.match(evidence, /source_retrieved_not_fact_checked/);
  assert.match(evidence, /raw_html_stored: false/);
  assert.match(evidence, /content_published: false/);
});

test("article quality gate is deterministic and never authorizes publication", () => {
  assert.match(articleGate, /MIN_WORDS = 600/);
  assert.match(articleGate, /MIN_SOURCES = 3/);
  assert.match(articleGate, /author !== "DUNG - AI"/);
  assert.match(articleGate, /unsafe_markup/);
  assert.match(articleGate, /missing_inline_citations/);
  assert.match(articleGate, /publication_authorized: false/);
  assert.match(articleGate, /eligible_for_human_review/);
});

test("draft artifact storage is bounded, versioned, and non-publishing", async () => {
  const draftStore = await readFile(new URL("../src/draft-artifact-store.mjs", import.meta.url), "utf8");
  assert.match(draftStore, /MAX_ARTIFACT_BYTES = 48 \* 1024/);
  assert.match(draftStore, /MAX_SOURCES = 20/);
  assert.match(draftStore, /pending_human_review/);
  assert.match(draftStore, /needs_revision/);
  assert.match(draftStore, /version = version \+ 1/);
  assert.match(draftStore, /WHERE id = \? AND version = \?/);
  assert.doesNotMatch(draftStore, /published|publish\(/i);
});

test("research evidence readiness requires fresh distinct publishers and never authorizes publication", () => {
  assert.match(evidenceAssessment, /MIN_INDEPENDENT_SOURCES = 2/);
  assert.match(evidenceAssessment, /MAX_AGE_DAYS = 45/);
  assert.match(evidenceAssessment, /duplicate_publisher_domain/);
  assert.match(evidenceAssessment, /stale_source/);
  assert.match(evidenceAssessment, /evidence_packet_ready_for_claim_review/);
  assert.match(evidenceAssessment, /publication_authorized: false/);
  assert.match(source, /assessResearchEvidence/);
  assert.match(source, /evidence_assessment: evidenceAssessment/);
});

test("AI Bank candidate storage is allowlisted, bounded, persistent, and review-only", () => {
  assert.match(candidateStore, /ALLOWED_REPOSITORIES/);
  assert.match(candidateStore, /MAX_CANDIDATES_PER_BATCH = 10/);
  assert.match(candidateStore, /MAX_CANDIDATE_BYTES = 8192/);
  assert.match(candidateStore, /needs_official_source_review/);
  assert.match(candidateStore, /pricing_status !== "unverified"/);
  assert.match(candidateStore, /catalog_write_authorized !== false/);
  assert.match(candidateStore, /public_publication_authorized !== false/);
  assert.match(candidateStore, /listCandidates\(limit = 20\)/);
  assert.match(candidateStore, /LIMIT \?/);
  assert.match(candidateStore, /catalog_write_authorized: false/);
  assert.match(candidateStore, /submitReviewEvidence/);
  assert.match(candidateStore, /listReviewEvidence/);
  assert.match(candidateStore, /submitted_source_not_verified/);
  assert.match(candidateStore, /pending_human_review/);
  assert.match(candidateStore, /MAX_EVIDENCE_PER_CHECK = 5/);
  assert.match(candidateStore, /verification_authorized: false/);
  assert.match(candidateStore, /public_publication_authorized: false/);
});
