import { WorkflowEntrypoint } from "cloudflare:workers";
import { currentUtcBudgetDay } from "./utc-budget-day.mjs";
import { discoverAiBankReleaseSignals } from "./ai-bank-discovery.mjs";
import { discoverResearchSignals } from "./research-discovery.mjs";
import { retrieveResearchEvidence } from "./research-evidence.mjs";
import { assessResearchEvidence } from "./research-evidence-assessment.mjs";
import { buildArticleAuthoringBrief } from "./article-authoring-brief.mjs";
import { selectProvider } from "./provider-policy.mjs";
import { handleGoogleReviewerAuth, readGoogleReviewerSessionCookie, verifyGoogleReviewerSessionToken, AgentReviewerAuthStore } from "./google-reviewer-oauth.mjs";
import { REVIEWER_CONSOLE_HTML, REVIEWER_CONSOLE_JS } from "./reviewer-console.mjs";
export { AgentTaskStore } from "./task-store.mjs";
export { AgentDraftStore } from "./draft-artifact-store.mjs";
export { AgentAIBankCandidateStore } from "./ai-bank-candidate-store.mjs";
export { AgentReviewerAuthStore };

const SERVICE = "ai-thuc-chien-agent-runtime-preview";
const VERSION = "0.3.1";
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  }
});

function createBudgetedFetch(store, day, scope) {
  let calls = 0;
  return {
    count: () => calls,
    fetchImpl: async (input, init) => {
      const permit = await store.consumeExternalRequestBudget(day, scope);
      if (!permit.allowed) throw new Error("daily_external_request_budget_exhausted");
      calls += 1;
      return fetch(input, init);
    }
  };
}

async function executeTask(store, taskType, taskId, payload, handler, getExternalCalls = () => 0) {
  const enqueued = await store.enqueue({ id: taskId, task_type: taskType, payload });
  if (!enqueued.accepted) throw new Error("task_enqueue_rejected");
  if (enqueued.task.status === "completed") {
    return { status: "already_completed", result: enqueued.task.result, external_calls: 0 };
  }
  if (enqueued.task.status === "dead") {
    return { status: "dead_letter", attempts: enqueued.task.attempts, external_calls: 0 };
  }

  const claimed = await store.claim([taskType], taskId);
  if (!claimed.task) {
    return { status: enqueued.task.status === "leased" ? "already_leased" : "not_claimed", external_calls: 0 };
  }

  try {
    const result = await handler(claimed.task);
    if (result?.ok === false) {
      const retried = await store.retry(taskId, claimed.lease_token, result.status || "task_not_ready");
      return { status: retried.status || "retry_not_applied", error_code: result.status || "task_not_ready", external_calls: result.external_calls || 0 };
    }
    const completed = await store.complete(taskId, claimed.lease_token, result);
    if (!completed.updated) throw new Error("task_completion_rejected");
    return { status: "completed", result, external_calls: result?.external_calls || 0 };
  } catch (error) {
    const errorCode = String(error?.message || "task_execution_failed")
      .replace(/[^a-zA-Z0-9_.:-]/g, "_")
      .slice(0, 80);
    if (errorCode === "daily_external_request_budget_exhausted") {
      const terminal = await store.abandon(taskId, claimed.lease_token, errorCode);
      return {
        status: terminal.status || "terminal_failure_not_applied",
        error_code: errorCode,
        external_calls: getExternalCalls()
      };
    }
    const retried = await store.retry(taskId, claimed.lease_token, errorCode);
    return { status: retried.status || "retry_not_applied", error_code: errorCode, external_calls: getExternalCalls() };
  }
}

export class AgentSupervisorWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const startedAt = new Date().toISOString();
    if (this.env.AGENT_ENABLED !== "true" || this.env.AGENT_PAUSED === "true") {
      return {
        service: SERVICE,
        version: VERSION,
        status: this.env.AGENT_PAUSED === "true" ? "paused" : "disabled",
        cycle: {
          scheduled_at: event.timestamp ? new Date(event.timestamp).toISOString() : startedAt,
          observed_at: startedAt,
          tasks_considered: 0,
          external_calls: 0,
          queue_accessed: false
        }
      };
    }
    const cycle = await step.do("execute-bounded-health-and-readonly-discovery", async () => {
      const store = this.env.AGENT_TASK_STORE.getByName("primary");
      const retention = await store.pruneTerminalTasks();
      const cycleId = String(event.instanceId || event.payload?.cycle_id || startedAt);
      const scheduledAt = event.timestamp ? new Date(event.timestamp).toISOString() : startedAt;
      const safeCycleId = cycleId.replace(/[^a-zA-Z0-9._:-]/g, "-");
      const healthTaskId = "runtime-health-" + safeCycleId;
      const health = await executeTask(
        store,
        "runtime_health_check",
        healthTaskId,
        {},
        async () => ({
          ok: true,
          check: "runtime_health_check",
          healthy: true,
          observed_at: new Date().toISOString(),
          queue: await store.stats(),
          external_calls: 0,
          production_access: false
        })
      );

      const budgetDay = currentUtcBudgetDay();
      const scanDate = budgetDay.replace(/-/g, "");
      const scanTaskId = "ai-bank-scan-" + scanDate;
      const aiBankBudget = createBudgetedFetch(store, budgetDay, "ai_bank_discovery");
      const discovery = await executeTask(
        store,
        "ai_bank_discovery",
        scanTaskId,
        { query: "daily_allowlisted_release_scan" },
        async () => {
          const result = await discoverAiBankReleaseSignals({
            lookbackDays: 30,
            fetchImpl: aiBankBudget.fetchImpl
          });
          return { ...result, external_calls: aiBankBudget.count() };
        },
        aiBankBudget.count
      );

      let candidateStore = {
        accepted: false,
        reason: "discovery_result_unavailable",
        total: null,
        catalog_write_authorized: false
      };
      if (discovery.result && Array.isArray(discovery.result.catalog_candidates)) {
        try {
          const candidateStoreBinding = this.env.AGENT_AI_BANK_CANDIDATE_STORE.getByName("primary");
          candidateStore = await candidateStoreBinding.upsertCandidates(
            discovery.result.catalog_candidates
          );
        } catch {
          candidateStore = {
            accepted: false,
            reason: "candidate_store_unavailable",
            total: null,
            catalog_write_authorized: false
          };
        }
      }

      const researchTaskId = "research-scan-" + scanDate;
      const researchBudget = createBudgetedFetch(store, budgetDay, "content_research");
      const research = await executeTask(
        store,
        "content_research",
        researchTaskId,
        { topic: "AI agents, automation, and open-source AI tools", language: "vi" },
        async () => {
          const discovered = await discoverResearchSignals({
            lookbackDays: 14,
            fetchImpl: researchBudget.fetchImpl
          });
          const evidence = await retrieveResearchEvidence(discovered.latest_signals, {
            now: Date.now(),
            fetchImpl: researchBudget.fetchImpl
          });
          const evidenceAssessment = assessResearchEvidence(evidence.evidence, { now: Date.now() });
          return {
            ...discovered,
            sources_checked: discovered.sources_checked + evidence.attempts,
            evidence_retrieval: evidence,
            evidence_assessment: evidenceAssessment,
            external_calls: researchBudget.count(),
            research_notice: "Retrieved excerpts are provenance-bound research evidence, not fact-checked claims or a publishable article."
          };
        },
        researchBudget.count
      );

      let contentDraft = {
        status: "skipped_research_unavailable",
        artifact_created: false,
        external_calls: 0,
        publication_authorized: false
      };
      if (["completed", "already_completed"].includes(research.status) && Array.isArray(research.result?.evidence_retrieval?.evidence)) {
        const draftTaskId = "article-brief-" + scanDate;
        contentDraft = await executeTask(
          store,
          "content_draft",
          draftTaskId,
          {
            topic: "Ứng dụng AI Agent trong tự động hóa công việc và phát triển sản phẩm",
            research_task_id: researchTaskId
          },
          async task => {
            const authoringPolicy = selectProvider("content_draft", [{
              id: "article-authoring-brief",
              status: "ready",
              execution_surface: "agent_runtime",
              cost_class: "no_external_execution",
              capabilities: ["content_draft"]
            }]);
            if (authoringPolicy.action !== "execute" ||
                authoringPolicy.provider !== "article-authoring-brief") {
              return {
                status: "authoring_provider_deferred",
                reason: authoringPolicy.reason,
                artifact_created: false,
                publication_authorized: false,
                external_calls: 0
              };
            }
            const brief = buildArticleAuthoringBrief({
              topic: task.payload.topic,
              researchEvidence: research.result.evidence_retrieval.evidence,
              now: Date.now()
            });
            if (!brief.prepared) {
              return {
                status: brief.status,
                reason: brief.reason,
                artifact_created: false,
                publication_authorized: false,
                external_calls: 0
              };
            }
            const draftStore = this.env.AGENT_DRAFT_STORE.getByName("primary");
            const persisted = await draftStore.createDraft(draftTaskId, brief.draft);
            if (!persisted.accepted) {
              return {
                status: "authoring_brief_persistence_rejected",
                reason: persisted.reason,
                artifact_created: false,
                publication_authorized: false,
                external_calls: 0
              };
            }
            return {
              status: "human_authoring_required",
              artifact_id: persisted.artifact.id,
              artifact_version: persisted.artifact.version,
              artifact_status: persisted.artifact.status,
              duplicate: persisted.duplicate,
              quality_review: persisted.artifact.quality_review,
              artifact_created: !persisted.duplicate,
              publication_authorized: false,
              external_calls: 0,
              notice: "An internal authoring scaffold was stored. It requires substantial human writing, fact-checking, and review; it is not a publishable article."
            };
          }
        );
      }

      const externalCalls = discovery.external_calls + research.external_calls + contentDraft.external_calls;
      const dailyBudgets = {
        day: budgetDay,
        ai_bank_discovery: await store.getExternalRequestBudget(budgetDay, "ai_bank_discovery"),
        content_research: await store.getExternalRequestBudget(budgetDay, "content_research")
      };
      return {
        cycle_id: cycleId,
        scheduled_at: scheduledAt,
        observed_at: new Date().toISOString(),
        mode: "bounded_health_ai_bank_research_and_authoring",
        queue: await store.stats(),
        retention,
        tasks: { health, ai_bank_discovery: discovery, content_research: research, content_draft: contentDraft },
        ai_bank_candidate_store: candidateStore,
        tasks_considered: 4,
        tasks_completed: [health, discovery, research, contentDraft].filter(item =>
          item.status === "completed"
        ).length,
        external_calls: externalCalls,
        daily_budgets: dailyBudgets,
        catalog_modified: false,
        public_content_modified: false,
        production_access: false
      };
    });
    return { service: SERVICE, version: VERSION, status: "healthy", cycle };
  }
}

export default {
  async fetch(request, env) {
    const reviewerAuthResponse = await handleGoogleReviewerAuth(request, env);
    if (reviewerAuthResponse) return reviewerAuthResponse;
    const url = new URL(request.url);
    if (url.pathname === "/reviewer-console" || url.pathname === "/reviewer-console.js") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      if (url.pathname === "/reviewer-console") {
        return new Response(REVIEWER_CONSOLE_HTML, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "no-referrer",
            "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
          }
        });
      }
      return new Response(REVIEWER_CONSOLE_JS, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer"
        }
      });
    }
    const reviewerAIBankCollection = url.pathname === "/api/reviewer/ai-bank/candidates";
    const reviewerAIBankDetail = url.pathname.match(/^\\/api\\/reviewer\\/ai-bank\\/candidates\\/([a-zA-Z0-9_.-]{1,160})$/);
    if (reviewerAIBankCollection || reviewerAIBankDetail) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return json({ error: "review_request_origin_or_content_type_rejected" }, 403);
      const sessionToken = readGoogleReviewerSessionCookie(request);
      if (!sessionToken) return json({ error: "reviewer_session_required" }, 401);
      const session = await verifyGoogleReviewerSessionToken(sessionToken, env);
      if (!session.authenticated) {
        return json({ error: session.status || "reviewer_session_invalid" }, session.status === "reviewer_auth_not_configured" ? 503 : 401);
      }
      const candidateStore = env.AGENT_AI_BANK_CANDIDATE_STORE?.getByName("primary");
      if (!candidateStore) return json({ error: "ai_bank_candidate_store_unavailable" }, 503);
      if (reviewerAIBankCollection) {
        const values = url.searchParams.getAll("limit");
        if (values.length > 1 || (values.length === 1 && !/^(?:[1-9]|1[0-9]|20)$/.test(values[0]))) {
          return json({ error: "invalid_ai_bank_candidate_limit" }, 400);
        }
        const limit = values.length ? Number(values[0]) : 20;
        const items = await candidateStore.listCandidates(limit);
        return json({
          items,
          count: items.length,
          reviewer_ref: session.reviewer.reviewer_ref,
          catalog_write_authorized: false,
          public_publication_authorized: false
        });
      }
      const packet = await candidateStore.getReviewPacket("github:" + reviewerAIBankDetail[1]);
      if (!packet) return json({ error: "ai_bank_candidate_not_found" }, 404);
      return json({
        packet,
        reviewer_ref: session.reviewer.reviewer_ref,
        verification_authorized: false,
        catalog_write_authorized: false,
        public_publication_authorized: false
      });
    }
    const reviewerDraftCollection = url.pathname === "/api/reviewer/drafts";
    const reviewerDraftDetail = url.pathname.match(/^\/api\/reviewer\/drafts\/([a-zA-Z0-9._:-]{8,128})$/);
    if (reviewerDraftCollection || reviewerDraftDetail) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return json({ error: "review_request_origin_or_content_type_rejected" }, 403);
      const sessionToken = readGoogleReviewerSessionCookie(request);
      if (!sessionToken) return json({ error: "reviewer_session_required" }, 401);
      const draftStore = env.AGENT_DRAFT_STORE?.getByName("primary");
      if (!draftStore) return json({ error: "draft_store_unavailable" }, 503);
      if (reviewerDraftCollection) {
        const values = url.searchParams.getAll("limit");
        if (values.length > 1 || (values.length === 1 && !/^(?:[1-9]|1[0-9]|20)$/.test(values[0]))) {
          return json({ error: "invalid_review_queue_limit" }, 400);
        }
        const limit = values.length ? Number(values[0]) : 20;
        const result = await draftStore.listPendingReviewsForReviewer(limit, sessionToken);
        if (!result.authorized) return json({ error: result.reason || "reviewer_session_invalid" }, 401);
        return json({ items: result.items, count: result.items.length, publication_authorized: false });
      }
      const result = await draftStore.getDraftForReviewer(reviewerDraftDetail[1], sessionToken);
      if (!result.authorized) return json({ error: result.reason || "reviewer_session_invalid" }, 401);
      if (!result.artifact) return json({ error: "draft_not_found" }, 404);
      return json({ artifact: result.artifact, publication_authorized: false });
    }
    const reviewerEvidenceMatch = url.pathname.match(new RegExp("^/api/reviewer/drafts/([a-zA-Z0-9._:-]{8,128})/evidence-review$"));
    if (reviewerEvidenceMatch) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (request.headers.get("origin") !== url.origin ||
          (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
        return json({ error: "review_request_origin_or_content_type_rejected" }, 403);
      }
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > 96 * 1024) return json({ error: "review_request_too_large" }, 413);
      const sessionToken = readGoogleReviewerSessionCookie(request);
      if (!sessionToken) return json({ error: "reviewer_session_required" }, 401);
      let body;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > 96 * 1024) return json({ error: "review_request_too_large" }, 413);
        body = JSON.parse(raw);
      } catch { return json({ error: "invalid_review_request_json" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some(key => !["expected_version", "ledger", "review_record"].includes(key)) ||
          !Number.isInteger(body.expected_version) || !body.ledger || !body.review_record) {
        return json({ error: "invalid_review_request_shape" }, 400);
      }
      const draftStore = env.AGENT_DRAFT_STORE?.getByName("primary");
      if (!draftStore) return json({ error: "draft_store_unavailable" }, 503);
      const result = await draftStore.recordEvidenceReview(
        reviewerEvidenceMatch[1], body.expected_version, body.ledger, body.review_record, sessionToken
      );
      if (!result.recorded) return json({ error: result.reason, readiness: result.readiness || null }, 400);
      return json({
        recorded: true,
        owner_release_review_eligible: result.owner_release_review_eligible,
        readiness: result.readiness,
        publication_authorized: false,
        content_published: false,
        social_post_published: false
      });
    }
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: SERVICE,
        version: VERSION,
        mode: "preview_foundation",
        enabled: env.AGENT_ENABLED === "true",
        paused: env.AGENT_PAUSED === "true",
        scheduler: env.AGENT_SCHEDULE_MODE || "not_configured",
        task_execution_enabled: env.AGENT_ENABLED === "true" && env.AGENT_PAUSED !== "true",
        ai_bank_discovery: "read_only_daily_allowlisted_github_releases",
        content_research: "read_only_daily_official_feeds_and_bounded_source_evidence_retrieval",
        ai_inference_enabled: false,
        content_draft_executor_enabled: true,
        quality_review_executor_enabled: false,
        website_publication_enabled: false,
        facebook_publication_enabled: false,
        reviewer_auth_enabled: env.AGENT_REVIEWER_AUTH_ENABLED === "true",
        task_enqueue_endpoint_enabled: false,
        production_access: false
      });
    }
    if (url.pathname === "/") {
      return json({
        service: SERVICE,
        status: "preview_foundation",
        message: "Agent runtime is isolated. It runs bounded local health checks, AI Bank release discovery, and AI research-source discovery with limited source excerpts."
      });
    }
    return json({ error: "not_found" }, 404);
  }
};
