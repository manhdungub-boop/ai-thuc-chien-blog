import test from "node:test";
import assert from "node:assert/strict";
import { createReadOnlyAgentManager, READ_ONLY_AGENT_MANAGER_LIMITS } from "../src/read-only-agent-manager.mjs";

const makeTask = (type, key, payload) => ({ type, idempotencyKey: key, payload });
const article = (key = "manager-article-key-0001") => makeTask("content.review", key, { articlePath: "articles/example.html" });
const bank = (key = "manager-bank-key-000001") => makeTask("ai_bank.candidate_review", key, { candidateId: "chatgpt" });
const seo = (key = "manager-seo-key-000001") => makeTask("seo.audit", key, { path: "/articles/example" });

const snapshots = {
  "content.review": {
    articlePath: "articles/example.html", title: "A complete article title",
    description: "A sufficiently detailed article description that exceeds fifty characters.",
    canonicalUrl: "https://example.com/articles/example", author: "DUNG - AI",
    hasBlogPostingJsonLd: true, hasAttributionNote: true, wordCount: 900, internalLinkCount: 3,
  },
  "ai_bank.candidate_review": {
    candidateId: "chatgpt", name: "ChatGPT", vendor: "OpenAI", website: "https://chatgpt.com/",
    officialSources: ["https://openai.com/"], pricingModel: "freemium",
    pricingStatus: "verified_free_tier", lastVerified: "2026-11-15",
    verificationStatus: "verified", duplicateId: null,
  },
  "seo.audit": {
    path: "/articles/example", statusCode: 200, title: "A complete article title",
    description: "A sufficiently detailed article description that exceeds fifty characters.",
    canonicalUrl: "https://example.com/articles/example", robotsIndexable: true,
    hasJsonLd: true, sitemapIncluded: true, internalLinkCount: 3, brokenInternalLinkCount: 0,
  },
};

test("manager aggregates all three task families into a deterministic report", async () => {
  const calls = [];
  const manager = createReadOnlyAgentManager({
    snapshotAdapter: { async getSnapshot(task) { calls.push(task.type); return { ok: true, snapshot: snapshots[task.type] }; } },
  });
  const report = await manager.reviewBatch([article(), bank(), seo()]);
  assert.equal(report.ok, true);
  assert.equal(report.status, "pass");
  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.pass, 3);
  assert.equal(report.summary.findingCount, 0);
  assert.deepEqual(calls, ["content.review", "ai_bank.candidate_review", "seo.audit"]);
  assert.ok(report.items.every(item => item.execution === "not_started"));
  assert.deepEqual(report.sideEffects, []);
});

test("manager prioritizes errors and aggregates findings with task context", async () => {
  const manager = createReadOnlyAgentManager({
    snapshotAdapter: { async getSnapshot(task) {
      return { ok: true, snapshot: {
        ...snapshots[task.type],
        ...(task.type === "ai_bank.candidate_review" ? { duplicateId: "duplicate-record" } : {}),
      }};
    }},
  });
  const report = await manager.reviewBatch([article(), bank()]);
  assert.equal(report.status, "review_required");
  assert.equal(report.summary.reviewRequired, 1);
  assert.ok(report.summary.findings.some(x => x.taskType === "ai_bank.candidate_review" && x.code === "candidate_duplicate"));
});

test("invalid tasks and duplicate idempotency keys are rejected without duplicate reads", async () => {
  let reads = 0;
  const manager = createReadOnlyAgentManager({
    snapshotAdapter: { async getSnapshot(task) { reads++; return { ok: true, snapshot: snapshots[task.type] }; } },
  });
  const first = article("manager-shared-key-00001");
  const duplicate = bank("manager-shared-key-00001");
  const invalid = { ...seo(), payload: { path: "/../secret" } };
  const report = await manager.reviewBatch([first, duplicate, invalid]);
  assert.equal(reads, 1);
  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.reviewRequired, 2);
  assert.equal(report.items[1].error, "batch_idempotency_key_duplicate");
  assert.match(report.items[2].error, /^task_invalid:/);
});

test("source failures are isolated and later tasks continue sequentially", async () => {
  const calls = [];
  const manager = createReadOnlyAgentManager({
    snapshotAdapter: { async getSnapshot(task) {
      calls.push(task.type);
      if (task.type === "content.review") throw new Error("private failure");
      return { ok: true, snapshot: snapshots[task.type] };
    }},
  });
  const report = await manager.reviewBatch([article(), bank()]);
  assert.deepEqual(calls, ["content.review", "ai_bank.candidate_review"]);
  assert.equal(report.items[0].error, "snapshot_unavailable");
  assert.equal(report.items[1].status, "pass");
  assert.equal(report.summary.reviewRequired, 1);
});

test("manager enforces bounded batches and requires an injected reader", async () => {
  assert.throws(() => createReadOnlyAgentManager({}), /read_only_snapshot_adapter_required/);
  const manager = createReadOnlyAgentManager({ snapshotAdapter: { async getSnapshot() {} } });
  assert.equal((await manager.reviewBatch([])).error, "batch_size_invalid");
  assert.equal((await manager.reviewBatch(Array(READ_ONLY_AGENT_MANAGER_LIMITS.maxBatchTasks + 1).fill(article()))).error, "batch_size_invalid");
  assert.equal(READ_ONLY_AGENT_MANAGER_LIMITS.concurrency, 1);
  assert.equal(READ_ONLY_AGENT_MANAGER_LIMITS.persistsResults, false);
});
