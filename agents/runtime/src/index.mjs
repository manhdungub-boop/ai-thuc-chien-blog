import { WorkflowEntrypoint } from "cloudflare:workers";
import { discoverAiBankReleaseSignals } from "./ai-bank-discovery.mjs";
export { AgentTaskStore } from "./task-store.mjs";

const SERVICE = "ai-thuc-chien-agent-runtime-preview";
const VERSION = "0.3.0";
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  }
});

async function executeTask(store, taskType, taskId, payload, handler) {
  const enqueued = await store.enqueue({ id: taskId, task_type: taskType, payload });
  if (!enqueued.accepted) throw new Error("task_enqueue_rejected");
  if (enqueued.task.status === "completed") {
    return { status: "already_completed", result: enqueued.task.result };
  }
  if (enqueued.task.status === "dead") {
    return { status: "dead_letter", attempts: enqueued.task.attempts };
  }

  const claimed = await store.claim([taskType], taskId);
  if (!claimed.task) {
    return { status: enqueued.task.status === "leased" ? "already_leased" : "not_claimed" };
  }

  try {
    const result = await handler(claimed.task);
    if (result?.ok === false) {
      const retried = await store.retry(taskId, claimed.lease_token, result.status || "task_not_ready");
      return { status: retried.status || "retry_not_applied", error_code: result.status || "task_not_ready" };
    }
    const completed = await store.complete(taskId, claimed.lease_token, result);
    if (!completed.updated) throw new Error("task_completion_rejected");
    return { status: "completed", result };
  } catch (error) {
    const errorCode = String(error?.message || "task_execution_failed")
      .replace(/[^a-zA-Z0-9_.:-]/g, "_")
      .slice(0, 80);
    const retried = await store.retry(taskId, claimed.lease_token, errorCode);
    return { status: retried.status || "retry_not_applied", error_code: errorCode };
  }
}

export class AgentSupervisorWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const startedAt = new Date().toISOString();
    const cycle = await step.do("execute-bounded-health-and-readonly-discovery", async () => {
      const store = this.env.AGENT_TASK_STORE.getByName("primary");
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

      const scanDate = scheduledAt.slice(0, 10).replace(/-/g, "");
      const scanTaskId = "ai-bank-scan-" + scanDate;
      const discovery = await executeTask(
        store,
        "ai_bank_discovery",
        scanTaskId,
        { query: "daily_allowlisted_release_scan" },
        () => discoverAiBankReleaseSignals({ lookbackDays: 30 })
      );

      const discoveryResult = discovery.result || null;
      const externalCalls = discoveryResult?.sources_checked || 0;
      return {
        cycle_id: cycleId,
        scheduled_at: scheduledAt,
        observed_at: new Date().toISOString(),
        mode: "bounded_health_and_readonly_discovery",
        queue: await store.stats(),
        tasks: { health, ai_bank_discovery: discovery },
        tasks_dispatched: 2,
        tasks_completed: [health, discovery].filter(item =>
          item.status === "completed" || item.status === "already_completed"
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
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: SERVICE,
        version: VERSION,
        mode: "preview_foundation",
        scheduler: "workflow_every_15_minutes",
        task_execution_enabled: true,
        ai_bank_discovery: "read_only_daily_allowlisted_github_releases",
        task_enqueue_endpoint_enabled: false,
        production_access: false
      });
    }
    if (url.pathname === "/") {
      return json({
        service: SERVICE,
        status: "preview_foundation",
        message: "Agent runtime is isolated. It runs bounded local health checks and read-only AI Bank release discovery."
      });
    }
    return json({ error: "not_found" }, 404);
  }
};
