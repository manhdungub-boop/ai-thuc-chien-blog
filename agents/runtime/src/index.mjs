import { WorkflowEntrypoint } from "cloudflare:workers";
import { discoverAiBankReleaseSignals } from "./ai-bank-discovery.mjs";
import { discoverResearchSignals } from "./research-discovery.mjs";
import { retrieveResearchEvidence } from "./research-evidence.mjs";
import { assessResearchEvidence } from "./research-evidence-assessment.mjs";
export { AgentTaskStore } from "./task-store.mjs";
export { AgentDraftStore } from "./draft-artifact-store.mjs";
export { AgentAIBankCandidateStore } from "./ai-bank-candidate-store.mjs";

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

      const budgetDay = scheduledAt.slice(0, 10);
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

      const externalCalls = discovery.external_calls + research.external_calls;
      return {
        cycle_id: cycleId,
        scheduled_at: scheduledAt,
        observed_at: new Date().toISOString(),
        mode: "bounded_health_ai_bank_and_research_discovery",
        queue: await store.stats(),
        retention,
        tasks: { health, ai_bank_discovery: discovery, content_research: research },
        ai_bank_candidate_store: candidateStore,
        tasks_considered: 3,
        tasks_completed: [health, discovery, research].filter(item =>
          item.status === "completed"
        ).length,
        external_calls: externalCalls,
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
    const url = new URL(request.url);
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
        content_draft_executor_enabled: false,
        quality_review_executor_enabled: false,
        website_publication_enabled: false,
        facebook_publication_enabled: false,
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
