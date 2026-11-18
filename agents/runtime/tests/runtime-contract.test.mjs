import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentUtcBudgetDay } from "../src/utc-budget-day.mjs";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const previewConfig = JSON.parse(await readFile(new URL("../wrangler.preview.jsonc", import.meta.url), "utf8"));
const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
const providerPolicySource = await readFile(new URL("../src/provider-policy.mjs", import.meta.url), "utf8");
const store = await readFile(new URL("../src/task-store.mjs", import.meta.url), "utf8");
const research = await readFile(new URL("../src/research-discovery.mjs", import.meta.url), "utf8");
const evidence = await readFile(new URL("../src/research-evidence.mjs", import.meta.url), "utf8");
const evidenceAssessment = await readFile(new URL("../src/research-evidence-assessment.mjs", import.meta.url), "utf8");
const articleGate = await readFile(new URL("../src/article-quality-gate.mjs", import.meta.url), "utf8");
const candidateStore = await readFile(new URL("../src/ai-bank-candidate-store.mjs", import.meta.url), "utf8");
const budgetDay = await readFile(new URL("../src/utc-budget-day.mjs", import.meta.url), "utf8");
const boundedJson = await readFile(new URL("../src/bounded-json-response.mjs", import.meta.url), "utf8");
const googleOAuth = await readFile(new URL("../src/google-reviewer-oauth.mjs", import.meta.url), "utf8");
const googleOidc = await readFile(new URL("../src/google-oidc-reviewer-verifier.mjs", import.meta.url), "utf8");
const previewDeployWorkflow = await readFile(new URL("../../../.github/workflows/deploy-agent-runtime-preview.yml", import.meta.url), "utf8");
const runtimeReadme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("Google OAuth and OIDC upstream JSON responses are byte-bounded", () => {
  assert.match(boundedJson, /getReader\(\)/);
  assert.match(boundedJson, /total > maxBytes/);
  assert.match(boundedJson, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(googleOAuth, /readBoundedJsonResponse\(tokenResponse, 32 \* 1024\)/);
  assert.match(googleOidc, /readBoundedJsonResponse\(response, 64 \* 1024\)/);
});

test("Preview deployment workflow is manual, explicitly confirmed, token-isolated, and health-gated", () => {
  assert.match(previewDeployWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(previewDeployWorkflow, /^\s*(push|pull_request|schedule):/m);
  assert.match(previewDeployWorkflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(previewDeployWorkflow, /confirm_preview_only:[\s\S]*default: false/);
  assert.match(previewDeployWorkflow, /inputs\.confirm_preview_only == true/);
  assert.match(previewDeployWorkflow, /secrets\.CLOUDFLARE_AGENT_PREVIEW_API_TOKEN/);
  assert.doesNotMatch(previewDeployWorkflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(previewDeployWorkflow, /timeout-minutes:\s*15/);
  assert.match(previewDeployWorkflow, /wrangler\.preview\.jsonc/);
  assert.doesNotMatch(previewDeployWorkflow, /wrangler\.jsonc/);
  assert.doesNotMatch(previewDeployWorkflow, /deploy-cloudflare-workers/);
  assert.match(previewDeployWorkflow, /wrangler deploy --dry-run/);
  assert.match(previewDeployWorkflow, /wrangler deploy --config wrangler\.preview\.jsonc/);
  assert.match(previewDeployWorkflow, /\.paused == true/);
  assert.match(previewDeployWorkflow, /manual_only_no_cron/);
  assert.match(previewDeployWorkflow, /production_access == false/);
  assert.match(previewDeployWorkflow, /content_draft_executor_enabled == true/);
  assert.doesNotMatch(previewDeployWorkflow, /content_draft_executor_enabled == false/);
  assert.match(source, /handleGoogleReviewerAuth\(request, env\)/);
  assert.ok(previewConfig.durable_objects.bindings.some(binding => binding.name === "AGENT_REVIEWER_AUTH_STORE"));
  assert.ok(previewConfig.migrations.some(migration => migration.tag === "v4-reviewer-auth-store"));
  assert.match(previewConfig.vars.AGENT_REVIEWER_AUTH_ENABLED, /^false$/);
  assert.match(runtimeReadme, /implements the Google authorization-code callback flow/);
  assert.match(runtimeReadme, /no Google OAuth client, real Preview redirect registration/);
  assert.doesNotMatch(runtimeReadme, /The module is not yet connected to a login callback/);

  assert.ok(
    previewDeployWorkflow.indexOf("wrangler deploy --dry-run") <
    previewDeployWorkflow.indexOf("wrangler deploy --config wrangler.preview.jsonc"),
    "Preview dry-run must precede deployment"
  );
});

test("default runtime config is disabled, paused, and has no recurring Workflow schedule", () => {
  assert.deepEqual(config.vars, {
    AGENT_ENABLED: "false",
    AGENT_PAUSED: "true",
    AGENT_SCHEDULE_MODE: "manual_only_no_cron",
    AGENT_REVIEWER_AUTH_ENABLED: "false"
  });
  assert.equal(config.workflows.length, 1);
  assert.equal(config.workflows[0].schedules, undefined);
  assert.equal(config.workflows[0].concurrency.limit, 1);
});

test("manual preview config is paused, has no recurring schedule, and uses isolated Worker resources", () => {
  assert.equal(previewConfig.name, "ai-thuc-chien-agent-runtime-preview");
  assert.equal(previewConfig.workers_dev, true);
  assert.deepEqual(previewConfig.vars, {
    AGENT_ENABLED: "false",
    AGENT_PAUSED: "true",
    AGENT_SCHEDULE_MODE: "manual_only_no_cron",
    AGENT_REVIEWER_AUTH_ENABLED: "false"
  });
  assert.equal(previewConfig.workflows.length, 1);
  assert.equal(previewConfig.workflows[0].schedules, undefined);
  assert.equal(previewConfig.routes, undefined);
  assert.equal(previewConfig.d1_databases, undefined);
  assert.equal(previewConfig.ai, undefined);
  assert.deepEqual(previewConfig.durable_objects.bindings, [...config.durable_objects.bindings, { name: "AGENT_REVIEWER_AUTH_STORE", class_name: "AgentReviewerAuthStore" }]);
  assert.deepEqual(previewConfig.migrations, [...config.migrations, { tag: "v4-reviewer-auth-store", new_sqlite_classes: ["AgentReviewerAuthStore"] }]);
});

test("runtime has isolated SQLite storage and no website Production bindings", () => {
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.vars, {
    AGENT_ENABLED: "false",
    AGENT_PAUSED: "true",
    AGENT_SCHEDULE_MODE: "manual_only_no_cron",
    AGENT_REVIEWER_AUTH_ENABLED: "false"
  });
  assert.equal(config.workflows[0].schedules, undefined);
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
  assert.match(source, /scheduler: env.AGENT_SCHEDULE_MODE \|\| "not_configured"/);
  assert.match(source, /ai_inference_enabled: false/);
  assert.match(source, /content_draft_executor_enabled: true/);
  assert.match(source, /quality_review_executor_enabled: false/);
  assert.match(source, /website_publication_enabled: false/);
  assert.match(source, /facebook_publication_enabled: false/);
  assert.match(source, /reviewer_auth_enabled: env\.AGENT_REVIEWER_AUTH_ENABLED === "true"/);
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
  assert.match(source, /buildArticleAuthoringBrief/);
  assert.match(source, /draftStore\.createDraft\(draftTaskId, brief\.draft\)/);
  assert.match(source, /research\.result\?\.evidence_retrieval\?\.evidence/);
  assert.match(source, /\["completed", "already_completed"\]\.includes\(research\.status\)/);
  assert.match(source, /artifact_status: persisted\.artifact\.status/);
  assert.match(source, /publication_authorized: false/);
  assert.match(source, /content_draft: contentDraft/);
  assert.match(source, /ai-bank-scan-/);
  assert.match(source, /ai_bank_discovery/);
  assert.match(source, /catalog_modified: false/);
  assert.match(source, /AGENT_AI_BANK_CANDIDATE_STORE/);
  assert.match(source, /upsertCandidates/);
  assert.match(source, /ai_bank_candidate_store: candidateStore/);
  assert.match(source, /tasks_considered: 4/);
  assert.match(source, /external_calls: externalCalls/);
  assert.match(source, /daily_budgets: dailyBudgets/);
  assert.match(source, /getExternalRequestBudget\(budgetDay, "ai_bank_discovery"\)/);
  assert.match(source, /getExternalRequestBudget\(budgetDay, "content_research"\)/);
  assert.match(store, /getExternalRequestBudget\(day, scope\)/);
  assert.match(source, /production_access: false/);
});

test("task store enforces an allowlist, bounded payloads, and idempotent IDs", () => {
  assert.match(store, /TASK_TYPES\.has\(task\.task_type\)/);
  assert.match(store, /function validatePayload\(type, payload\)/);
  assert.match(store, /ai_bank_discovery: \["query"\]/);
  assert.match(store, /content_research: \["topic", "language"\]/);
  assert.match(store, /content_draft: \["topic", "research_task_id"\]/);
  assert.match(store, /"content_draft",\s*"runtime_health_check"/);
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
  assert.match(source, /const budgetDay = currentUtcBudgetDay\(\)/);
  assert.doesNotMatch(source, /scheduledAt\.slice\(0, 10\)/);
  assert.match(budgetDay, /new Date\(now\)\.toISOString\(\)\.slice\(0, 10\)/);
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

test("article authoring brief remains human-authored and never creates a draft or claims", async () => {
  const brief = await readFile(new URL("../src/article-authoring-brief.mjs", import.meta.url), "utf8");
  assert.match(brief, /classifyResearchPublisher/);
  assert.match(brief, /unique\.size < 3/);
  assert.match(brief, /human_authoring_required/);
  assert.match(brief, /draft_created: false/);
  assert.match(brief, /claims_generated: false/);
  assert.match(brief, /publication_authorized: false/);
  assert.match(brief, /reviewArticleDraft\(draft\)/);
  assert.doesNotMatch(brief, /createDraft\(/);
  assert.doesNotMatch(brief, /fetch\(/);
});

test("draft evidence preparation requires the runtime budgeted fetch and exact stored source URLs", async () => {
  const preparation = await readFile(new URL("../src/prepare-draft-evidence-ledger.mjs", import.meta.url), "utf8");
  assert.match(preparation, /fetchImpl is mandatory/);
  assert.match(preparation, /typeof fetchImpl !== "function"/);
  assert.match(preparation, /sourceByUrl\.has\(url\)/);
  assert.match(preparation, /MAX_UNIQUE_SOURCES = 4/);
  assert.match(preparation, /retrieval\.retrieved !== signals\.length/);
  assert.match(preparation, /storeEvidenceLedger\(artifactId, artifact\.version/);
  assert.match(preparation, /publication_authorized: false/);
  assert.match(preparation, /content_published: false/);
  assert.doesNotMatch(preparation, /fetch\(signals|fetch\(url/);
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
  assert.match(candidateStore, /getReviewPacket/);
  assert.match(candidateStore, /verification_status: "not_verified"/);
  assert.match(candidateStore, /human_review_required: true/);
  assert.match(candidateStore, /submitted_source_not_verified/);
  assert.match(candidateStore, /pending_human_review/);
  assert.match(candidateStore, /MAX_EVIDENCE_PER_CHECK = 5/);
  assert.match(candidateStore, /verification_authorized: false/);
  assert.match(candidateStore, /public_publication_authorized: false/);
});

test("reviewer evidence endpoint is Google-session-bound and non-publishing", async () => {
  const runtime = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  const draftStore = await readFile(new URL("../src/draft-artifact-store.mjs", import.meta.url), "utf8");
  const verifier = await readFile(new URL("../src/human-review-record-verifier.mjs", import.meta.url), "utf8");
  assert.match(runtime, /handleGoogleReviewerAuth\(request, env\)/);
  assert.match(runtime, /api\/reviewer\/drafts/);
  assert.match(runtime, /request\.headers\.get\("origin"\) !== url\.origin/);
  assert.match(runtime, /readGoogleReviewerSessionCookie\(request\)/);
  assert.match(runtime, /recordEvidenceReview\([\s\S]*sessionToken/);
  assert.match(draftStore, /verifyGoogleReviewerSessionToken\(reviewerSessionToken, this\.env/);
  assert.match(draftStore, /authenticatedReviewer: \{ authenticated: true, reviewer_ref: reviewerSession\.reviewer\.reviewer_ref \}/);
  assert.match(verifier, /authenticatedReviewer\.reviewer_ref === record\.reviewer_ref/);
  assert.match(verifier, /reviewer_identity_authenticated: reviewerIdentityAuthenticated/);
  assert.match(runtime, /listPendingReviewsForReviewer/);
  assert.match(runtime, /getDraftForReviewer/);
  assert.match(draftStore, /async listPendingReviewsForReviewer/);
  assert.match(draftStore, /async getDraftForReviewer/);
  assert.match(runtime, /publication_authorized: false/);
  assert.match(runtime, /social_post_published: false/);
});

test("daily quota date is derived from the UTC execution time and rejects invalid values", () => {
  assert.equal(currentUtcBudgetDay(Date.parse("2026-11-19T23:59:59.000Z")), "2026-11-19");
  assert.equal(currentUtcBudgetDay(Date.parse("2026-11-20T00:00:00.000Z")), "2026-11-20");
  assert.throws(() => currentUtcBudgetDay(-1), /invalid_budget_timestamp/);
  assert.throws(() => currentUtcBudgetDay(Number.NaN), /invalid_budget_timestamp/);
});
test("content authoring checks the fail-closed provider policy before building or persisting a brief", () => {
  assert.match(source, /import \{ selectProvider \} from "\.\/provider-policy\.mjs"/);
  assert.match(providerPolicySource, /"article-authoring-brief", new Set\(\["content_draft"\]\)/);
  const policyCall = source.indexOf('selectProvider("content_draft"');
  const policyBlock = source.indexOf('authoringPolicy.action !== "execute"', policyCall);
  const briefBuilder = source.indexOf("buildArticleAuthoringBrief({", policyCall);
  const persistence = source.indexOf("draftStore.createDraft(draftTaskId, brief.draft)", policyCall);
  assert.ok(policyCall >= 0, "runtime must invoke provider policy for content_draft");
  assert.ok(policyBlock > policyCall, "non-execute policy outcomes must stop the handler");
  assert.ok(briefBuilder > policyBlock, "authoring brief must be built only after policy approval");
  assert.ok(persistence > briefBuilder, "draft persistence must happen after the brief is built");
  assert.match(source, /status: "authoring_provider_deferred"/);
  assert.match(source, /publication_authorized: false/);
});
