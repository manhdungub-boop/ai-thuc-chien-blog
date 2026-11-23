import registry from "../agents/agent-registry.json" with { type: "json" };

const ROUTES = Object.freeze({
  planning: "manager",
  research: "research",
  ai_bank: "ai_bank",
  content: "content",
  media: "media",
  social: "social",
  quality: "qa_security",
  release_review: "release"
});

const ALLOWED_PERMISSIONS = new Set(["read_only", "staging_write"]);
const DENIED_DATA = new Set(registry.blocked_data_classes);
const ALLOWED_COST = new Set(registry.allowed_execution_cost_classes);

export function routeTask(task, config = registry) {
  const agentId = ROUTES[task?.task_type];
  if (!agentId) {
    return { ok: false, status: "BLOCKED", reason: "unsupported_task_type" };
  }
  const agent = config.agents.find((item) => item.id === agentId);
  if (!agent) {
    return { ok: false, status: "BLOCKED", reason: "agent_not_registered" };
  }
  return { ok: true, assigned_agent: agent.id, role: agent.role };
}

export function validateTask(task, config = registry) {
  const errors = [];
  const required = ["task_id", "goal", "task_type", "state", "permission_scope", "cost_class", "data_class", "acceptance_criteria"];
  for (const key of required) {
    if (task?.[key] === undefined || task[key] === null || task[key] === "") errors.push(`missing_${key}`);
  }

  if (task?.state && !config.task_states.includes(task.state)) errors.push("invalid_state");
  if (task?.permission_scope && !ALLOWED_PERMISSIONS.has(task.permission_scope)) errors.push("permission_not_allowed");
  if (task?.cost_class && !ALLOWED_COST.has(task.cost_class)) errors.push("cost_not_verified_zero");
  if (task?.data_class && DENIED_DATA.has(task.data_class)) errors.push("data_class_blocked");
  if (task?.data_class && !config.data_classes.includes(task.data_class)) errors.push("invalid_data_class");
  if (task?.cost_class && !config.cost_classes.includes(task.cost_class)) errors.push("invalid_cost_class");
  if (task?.state === "DONE" && (!Array.isArray(task.evidence) || task.evidence.length === 0)) errors.push("done_requires_evidence");
  if (task?.permission_scope === "staging_write" && task?.environment !== "isolated_preview") errors.push("staging_write_requires_isolated_preview");
  if (task?.requires_production_change === true) errors.push("production_change_forbidden");
  if (task?.requires_external_publication === true && task?.owner_approval !== true) errors.push("external_publication_requires_owner_approval");
  if (task?.requires_account_connection === true) errors.push("account_connection_requires_owner_action");

  const route = routeTask(task, config);
  if (!route.ok) errors.push(route.reason);
  if (!Array.isArray(task?.acceptance_criteria) || task.acceptance_criteria.length === 0) errors.push("acceptance_criteria_required");
  if (task?.allowed_tools !== undefined && !Array.isArray(task.allowed_tools)) errors.push("allowed_tools_must_be_array");

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "VALIDATED" : "BLOCKED",
    assigned_agent: route.ok ? route.assigned_agent : null,
    errors: [...new Set(errors)]
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/validate-agent-task.mjs <task.json>");
    process.exitCode = 2;
  } else {
    try {
      const { readFile } = await import("node:fs/promises");
      const task = JSON.parse(await readFile(inputPath, "utf8"));
      const result = validateTask(task);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      console.error(`Unable to validate task: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
