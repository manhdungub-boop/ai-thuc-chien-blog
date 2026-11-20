import { validateTaskRequest } from "./task-contract.mjs";
import { handleReadOnlyTask } from "./task-handlers.mjs";

const MAX_BATCH_TASKS = 20;
const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1 });

function itemFailure(taskType, error) {
  return Object.freeze({
    ok: false,
    mode: "read_only_manager",
    execution: "not_started",
    taskType: typeof taskType === "string" ? taskType : "unknown",
    status: "review_required",
    error,
    findings: Object.freeze([]),
    sideEffects: Object.freeze([]),
  });
}

function summarize(items) {
  const counts = { pass: 0, attention: 0, review_required: 0 };
  const findings = [];
  for (const item of items) {
    if (Object.hasOwn(counts, item.status)) counts[item.status]++;
    for (const entry of item.findings || []) {
      findings.push({
        taskType: item.taskType,
        code: entry.code,
        severity: entry.severity,
        message: entry.message,
      });
    }
  }
  findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
    a.taskType.localeCompare(b.taskType) ||
    a.code.localeCompare(b.code));
  return Object.freeze({
    total: items.length,
    pass: counts.pass,
    attention: counts.attention,
    reviewRequired: counts.review_required,
    findingCount: findings.length,
    findings: Object.freeze(findings),
  });
}

/**
 * Deterministic, sequential, read-only batch coordinator.
 * It accepts an injected snapshot adapter, validates every task before source reads,
 * and never persists, enqueues, publishes, retries or executes a task.
 */
export function createReadOnlyAgentManager({ snapshotAdapter } = {}) {
  if (!snapshotAdapter || typeof snapshotAdapter.getSnapshot !== "function") {
    throw new TypeError("read_only_snapshot_adapter_required");
  }

  return Object.freeze({
    async reviewBatch(taskInputs) {
      if (!Array.isArray(taskInputs) || taskInputs.length === 0 ||
          taskInputs.length > MAX_BATCH_TASKS) {
        return Object.freeze({
          ok: false,
          mode: "read_only_manager",
          execution: "not_started",
          error: "batch_size_invalid",
          items: Object.freeze([]),
          summary: summarize([]),
          sideEffects: Object.freeze([]),
        });
      }

      const seenKeys = new Set();
      const items = [];
      for (const input of taskInputs) {
        const validation = validateTaskRequest(input);
        if (!validation.ok) {
          items.push(itemFailure(input?.type, "task_invalid:" + validation.error));
          continue;
        }
        const task = validation.task;
        if (seenKeys.has(task.idempotencyKey)) {
          items.push(itemFailure(task.type, "batch_idempotency_key_duplicate"));
          continue;
        }
        seenKeys.add(task.idempotencyKey);

        let source;
        try {
          source = await snapshotAdapter.getSnapshot(task);
        } catch {
          source = null;
        }
        if (!source || source.ok !== true || !source.snapshot) {
          items.push(itemFailure(task.type,
            typeof source?.error === "string" ? source.error : "snapshot_unavailable"));
          continue;
        }

        const report = handleReadOnlyTask(task, source.snapshot);
        if (!report.ok) {
          items.push(itemFailure(task.type, report.error || "analysis_failed"));
          continue;
        }
        items.push(Object.freeze({
          ok: true,
          mode: "read_only_manager",
          execution: "not_started",
          taskType: report.taskType,
          status: report.status,
          findingCount: report.findingCount,
          findings: report.findings,
          sideEffects: Object.freeze([]),
        }));
      }

      const summary = summarize(items);
      return Object.freeze({
        ok: true,
        mode: "read_only_manager",
        execution: "not_started",
        status: summary.reviewRequired > 0 ? "review_required" :
          summary.attention > 0 ? "attention" : "pass",
        items: Object.freeze(items),
        summary,
        sideEffects: Object.freeze([]),
      });
    },
  });
}

export const READ_ONLY_AGENT_MANAGER_LIMITS = Object.freeze({
  maxBatchTasks: MAX_BATCH_TASKS,
  concurrency: 1,
  persistsResults: false,
  retriesAutomatically: false,
});
