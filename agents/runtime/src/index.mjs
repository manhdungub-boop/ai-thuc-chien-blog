import { WorkflowEntrypoint } from "cloudflare:workers";

const SERVICE = "ai-thuc-chien-agent-runtime-preview";
const VERSION = "0.1.0";
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
    const cycle = await step.do("record-supervisor-cycle", async () => ({
      cycle_id: String(event.instanceId || event.payload?.cycle_id || startedAt),
      scheduled_at: event.timestamp ? new Date(event.timestamp).toISOString() : startedAt,
      observed_at: startedAt,
      mode: "safe_idle",
      tasks_dispatched: 0,
      external_calls: 0,
      reason: "task_store_and_authorized_execution_adapters_not_yet_enabled"
    }));

    return {
      service: SERVICE,
      version: VERSION,
      status: "healthy_idle",
      cycle
    };
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
        scheduler: "workflow_every_15_minutes",
        task_execution_enabled: false,
        production_access: false
      });
    }
    if (url.pathname === "/") {
      return json({
        service: SERVICE,
        status: "preview_foundation",
        message: "Agent runtime is isolated. Specialist execution is not enabled."
      });
    }
    return json({ error: "not_found" }, 404);
  }
};
