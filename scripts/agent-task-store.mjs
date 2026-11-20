const STATES = ["RECEIVED","TRIAGED","PLANNED","IN_PROGRESS","REVIEW","DONE","BLOCKED","CANCELLED"];
const NEXT = {
  RECEIVED: ["TRIAGED","BLOCKED","CANCELLED"],
  TRIAGED: ["PLANNED","BLOCKED","CANCELLED"],
  PLANNED: ["IN_PROGRESS","BLOCKED","CANCELLED"],
  IN_PROGRESS: ["REVIEW","BLOCKED","CANCELLED"],
  REVIEW: ["DONE","IN_PROGRESS","BLOCKED","CANCELLED"],
  DONE: [], BLOCKED: ["TRIAGED","CANCELLED"], CANCELLED: []
};

export function validateQueue(queue) {
  const errors = [];
  if (!queue || queue.schema_version !== 1 || !Array.isArray(queue.tasks)) return { ok:false, errors:["invalid_queue_schema"] };
  const ids = new Set();
  for (const task of queue.tasks) {
    if (!task || typeof task.task_id !== "string" || !task.task_id.trim()) errors.push("task_id_required");
    else if (ids.has(task.task_id)) errors.push("duplicate_task_id");
    else ids.add(task.task_id);
    if (!STATES.includes(task.state)) errors.push("invalid_state");
    if (!Array.isArray(task.evidence)) errors.push("evidence_must_be_array");
    if (task.state === "DONE" && (!Array.isArray(task.evidence) || task.evidence.length === 0)) errors.push("done_requires_evidence");
  }
  return { ok: errors.length === 0, errors };
}

export function transitionTask(task, nextState, evidence = []) {
  if (!task || !STATES.includes(task.state) || !STATES.includes(nextState)) return { ok:false, error:"invalid_state" };
  if (!NEXT[task.state].includes(nextState)) return { ok:false, error:"transition_not_allowed" };
  const mergedEvidence = [...(Array.isArray(task.evidence) ? task.evidence : []), ...evidence];
  if (nextState === "DONE" && mergedEvidence.length === 0) return { ok:false, error:"done_requires_evidence" };
  return { ok:true, task:{ ...task, state:nextState, evidence:mergedEvidence } };
}

export function enqueueTask(queue, task) {
  const current = validateQueue(queue);
  if (!current.ok) return { ok:false, errors:current.errors };
  if (!task || typeof task.task_id !== "string" || !task.task_id.trim()) return { ok:false, errors:["task_id_required"] };
  if (queue.tasks.some(item => item.task_id === task.task_id)) return { ok:true, duplicate:true, queue };
  const next = { ...queue, tasks:[...queue.tasks, { ...task, evidence:Array.isArray(task.evidence) ? task.evidence : [] }] };
  const checked = validateQueue(next);
  return checked.ok ? { ok:true, duplicate:false, queue:next } : { ok:false, errors:checked.errors };
}

export const emptyQueue = () => ({ schema_version:1, tasks:[] });
