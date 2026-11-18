import { WorkflowEntrypoint } from "cloudflare:workers";
export { AgentTaskStore } from "./task-store.mjs";

const SERVICE = "ai-thuc-chien-agent-runtime-preview";
const VERSION = "0.2.0";
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  }
});

export class AgentSupervisorWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const startedAt = new Date().toISOString();
    const cycle = await step.do("execute-bounded-local-health-task", async () => {
      const store = this.env.AGENT_TASK_STORE.getByName("primary");
      const cycleId = String(event.instanceId || event.payload?.cycle_id || startedAt);
      const scheduledAt = event.timestamp ? new Date(event.timestamp).toISOString() : startedAt;
      const taskId = "runtime-health-" + cycleId.replace(/[^a-zA-Z0-9._:-]/g, "-");
      const enqueued = await store.enqueue({ id: taskId, task_type: "runtime_health_check", payload: {} });
      if (!enqueued.accepted) throw new Error("health_task_enqueue_failed");
      const claimed = await store.claim(["runtime_health_check"]);
      if (!claimed.task || claimed.task.id !== taskId) throw new Error("health_task_claim_failed");
      const before = await store.stats();
      const result = {
        check: "runtime_health_check",
        healthy: true,
        observed_at: new Date().toISOString(),
        queue_before_completion: before,
        external_calls: 0,
        production_access: false
      };
      const completed = await store.complete(taskId, claimed.lease_token, result);
      if (!completed.updated) throw new Error("health_task_completion_failed");
      return {
        cycle_id: cycleId,
        scheduled_at: scheduledAt,
        observed_at: result.observed_at,
        mode: "bounded_local_execution",
        queue: await store.stats(),
        tasks_dispatched: 1,
        tasks_completed: 1,
        external_calls: 0,
        result
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
        task_enqueue_endpoint_enabled: false,
        production_access: false
      });
    }
    if (url.pathname === "/") {
      return json({
        service: SERVICE,
        status: "preview_foundation",
        message: "Agent runtime is isolated. Only the deterministic local health-check task is enabled."
      });
    }
    return json({ error: "not_found" }, 404);
  }
};
