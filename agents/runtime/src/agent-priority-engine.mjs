const TYPE_PRIORITY = Object.freeze({
  "content.review": 30,
  "ai_bank.candidate_review": 20,
  "seo.audit": 10,
});
const MAX_ITEMS = 50;

/**
 * Stable, deterministic ordering only. Does not execute or mutate task objects.
 * Higher priority sorts first; original input order breaks ties.
 */
export function prioritizeAgentTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > MAX_ITEMS) {
    return Object.freeze({
      ok: false,
      error: "priority_batch_invalid",
      items: Object.freeze([]),
      sideEffects: Object.freeze([]),
    });
  }

  const seen = new Set();
  const items = [];
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    if (!task || typeof task !== "object" || Array.isArray(task) ||
        typeof task.id !== "string" || !/^[A-Za-z0-9._:-]{1,96}$/.test(task.id) ||
        typeof task.type !== "string" || !Object.hasOwn(TYPE_PRIORITY, task.type) ||
        seen.has(task.id)) {
      return Object.freeze({
        ok: false,
        error: "priority_task_invalid",
        items: Object.freeze([]),
        sideEffects: Object.freeze([]),
      });
    }
    seen.add(task.id);
    items.push({ id: task.id, type: task.type, priority: TYPE_PRIORITY[task.type], inputIndex: index });
  }

  items.sort((a, b) => b.priority - a.priority || a.inputIndex - b.inputIndex);
  return Object.freeze({
    ok: true,
    items: Object.freeze(items.map(({ inputIndex, ...item }) => Object.freeze(item))),
    sideEffects: Object.freeze([]),
  });
}

export const AGENT_PRIORITY_POLICY = Object.freeze({
  maxItems: MAX_ITEMS,
  weights: TYPE_PRIORITY,
  mutatesTasks: false,
  executesTasks: false,
});
