import test from "node:test";
import assert from "node:assert/strict";
import { createRepositoryReadOnlyReaders, REPOSITORY_READER_LIMITS } from "../src/repository-readers.mjs";
import { createReadOnlyTaskSnapshotAdapter } from "../src/task-snapshot-adapters.mjs";
import { handleReadOnlyTask } from "../src/task-handlers.mjs";

const taskKey = "repository-reader-2026-11-20";
const articleTask = {
  type: "content.review",
  idempotencyKey: taskKey,
  payload: { articlePath: "articles/activepieces-trigger-va-action.html" },
};
const bankTask = {
  type: "ai_bank.candidate_review",
  idempotencyKey: taskKey,
  payload: { candidateId: "chatgpt" },
};
const seoTask = {
  type: "seo.audit",
  idempotencyKey: taskKey,
  payload: { path: "/articles/activepieces-trigger-va-action" },
};

test("repository readers inspect actual checked-out article and AI Bank sources without writes", async () => {
  const readers = await createRepositoryReadOnlyReaders({
    repositoryRoot: process.cwd(),
    seoEvidenceReader: async () => ({ statusCode: 200, brokenInternalLinkCount: 0 }),
  });
  const adapter = createReadOnlyTaskSnapshotAdapter(readers);

  const article = await adapter.getSnapshot(articleTask);
  assert.equal(article.ok, true);
  assert.equal(article.snapshot.articlePath, articleTask.payload.articlePath);
  assert.match(article.snapshot.title, /Activepieces/i);
  assert.equal(article.snapshot.author, "DUNG - AI");

  const bank = await adapter.getSnapshot(bankTask);
  assert.equal(bank.ok, true);
  assert.equal(bank.snapshot.name, "ChatGPT");
  assert.equal(bank.snapshot.vendor, "OpenAI");
  assert.ok(bank.snapshot.officialSources.length > 0);
  assert.equal(bank.snapshot.lastVerified, "2026-11-15");

  assert.equal(article.execution, "not_started");
  assert.deepEqual(article.sideEffects, []);
  assert.deepEqual(bank.sideEffects, []);
});

test("repository SEO reader derives sitemap inclusion but requires external audit evidence", async () => {
  const readers = await createRepositoryReadOnlyReaders({
    repositoryRoot: process.cwd(),
    seoEvidenceReader: async (requestedPath) => {
      assert.equal(requestedPath, seoTask.payload.path);
      return { statusCode: 200, brokenInternalLinkCount: 0 };
    },
  });
  const adapter = createReadOnlyTaskSnapshotAdapter(readers);
  const result = await adapter.getSnapshot(seoTask);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.sitemapIncluded, true);
  assert.equal(result.snapshot.statusCode, 200);
  assert.equal(handleReadOnlyTask(seoTask, result.snapshot).status, "pass");
});

test("repository readers reject paths outside the explicit local allowlist", async () => {
  const readers = await createRepositoryReadOnlyReaders({
    repositoryRoot: process.cwd(),
    seoEvidenceReader: async () => ({ statusCode: 200, brokenInternalLinkCount: 0 }),
  });
  await assert.rejects(readers.readArticleHtml("../README.md"), /article_path_invalid/);
  await assert.rejects(readers.readSeoPage("/../../README.md"), /site_path_invalid/);
  await assert.rejects(readers.readSeoPage("/not-a-real-route"), /site_path_not_allowlisted/);
});

test("repository reader limits are explicit and bounded", () => {
  assert.equal(REPOSITORY_READER_LIMITS.maxHtmlBytes, 512 * 1024);
  assert.equal(REPOSITORY_READER_LIMITS.maxCatalogBytes, 512 * 1024);
  assert.equal(REPOSITORY_READER_LIMITS.maxSitemapBytes, 2 * 1024 * 1024);
});
