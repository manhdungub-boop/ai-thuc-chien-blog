import { readFile } from "node:fs/promises";
import { validateTask } from "./validate-agent-task.mjs";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/plan-agent-tasks.mjs <tasks.json>");
  process.exit(2);
}

try {
  const parsed = JSON.parse(await readFile(inputPath, "utf8"));
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("Input must be a non-empty task array or an object with a tasks array");
  }

  const results = tasks.map((task) => ({
    task_id: task?.task_id ?? null,
    goal: task?.goal ?? null,
    ...validateTask(task)
  }));

  const report = {
    mode: "plan_only_no_execution",
    total: results.length,
    accepted: results.filter((item) => item.ok).length,
    blocked: results.filter((item) => !item.ok).length,
    tasks: results
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.blocked > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Unable to plan tasks: ${error.message}`);
  process.exitCode = 2;
}
