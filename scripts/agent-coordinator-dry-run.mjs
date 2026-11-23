import { readFile } from "node:fs/promises";
import { validateTask } from "./validate-agent-task.mjs";
import { emptyQueue, enqueueTask, transitionTask } from "./agent-task-store.mjs";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/agent-coordinator-dry-run.mjs <tasks.json>");
  process.exit(2);
}

try {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const tasks = Array.isArray(input) ? input : input.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("A non-empty tasks array is required");

  let queue = emptyQueue();
  const report = [];
  for (const task of tasks) {
    const validation = validateTask(task);
    if (!validation.ok) {
      report.push({ task_id: task?.task_id ?? null, status:"BLOCKED", validation });
      continue;
    }
    const queued = enqueueTask(queue, { ...task, assigned_agent: validation.assigned_agent });
    if (!queued.ok) {
      report.push({ task_id:task.task_id, status:"BLOCKED", errors:queued.errors });
      continue;
    }
    queue = queued.queue;
    const triaged = transitionTask(task, "TRIAGED");
    report.push({
      task_id:task.task_id,
      assigned_agent:validation.assigned_agent,
      status:"PLAN_READY",
      next_state:triaged.ok ? triaged.task.state : "RECEIVED",
      duplicate:queued.duplicate,
      execution:"NOT_EXECUTED"
    });
  }
  console.log(JSON.stringify({
    mode:"offline_dry_run",
    external_calls:0,
    files_written:0,
    queue_task_count:queue.tasks.length,
    accepted:report.filter(item=>item.status==="PLAN_READY").length,
    blocked:report.filter(item=>item.status==="BLOCKED").length,
    tasks:report
  }, null, 2));
  if (report.some(item=>item.status==="BLOCKED")) process.exitCode=1;
} catch (error) {
  console.error(`Coordinator dry-run failed: ${error.message}`);
  process.exitCode=2;
}
