import test from "node:test";
import assert from "node:assert/strict";
import { createReadOnlyTaskSnapshotAdapter, TASK_SNAPSHOT_ADAPTER_LIMITS } from "../src/task-snapshot-adapters.mjs";
import { handleReadOnlyTask } from "../src/task-handlers.mjs";

const key = "task-2026-11-20-000001";
const contentTask = { type: "content.review", idempotencyKey: key, payload: { articlePath: "articles/example.html" } };
const bankTask = { type: "ai_bank.candidate_review", idempotencyKey: key, payload: { candidateId: "example-ai" } };
const seoTask = { type: "seo.audit", idempotencyKey: key, payload: { path: "/articles/example" } };
const html = `<!doctype html><html><head>
<meta name="description" content="Hướng dẫn thực hành AI với các bước cụ thể, nguồn tham khảo và ví dụ áp dụng an toàn trong công việc.">
<meta name="author" content="DUNG - AI">
<meta name="robots" content="index,follow">
<title>Hướng dẫn thực hành AI</title>
<link rel="canonical" href="https://example.com/articles/example">
<script type="application/ld+json">{"@type":"BlogPosting","author":{"@type":"Person","name":"DUNG - AI"}}</script>
</head><body><main><p class="article-byline"><strong>Tác giả:</strong> DUNG - AI</p>
<p>Đây là nội dung hướng dẫn thực hành có đủ thông tin kiểm chứng.</p>
<a href="../other.html">Bài liên quan</a><a href="https://outside.example/">External</a>
<section class="article-author-note"><p>Bài viết gốc do DUNG - AI biên soạn; liên kết về bài viết.</p></section>
</main></body></html>`;
const catalog = { schema_version: 1, tools: [
  { id: "example-ai", name: "Example AI", vendor: "Example Inc", website: "https://example.com/", official_sources: ["https://example.com/pricing"], pricing_model: "freemium", pricing_status: "verified_free_tier", last_verified: "2026-11-20", verification_status: "verified" },
  { id: "duplicate-ai", name: "Other Name", vendor: "Other Inc", website: "https://www.example.com/", official_sources: ["https://example.com/about"], pricing_model: "paid", pricing_status: "verified_paid", last_verified: "2026-11-20", verification_status: "verified" },
] };

test("article adapter reads only the validated article path and builds a reviewable snapshot", async () => {
  const calls = [];
  const adapter = createReadOnlyTaskSnapshotAdapter({
    async readArticleHtml(path) { calls.push(["article", path]); return html; },
    async readAiBankCatalog() { throw new Error("unexpected"); },
    async readSeoPage() { throw new Error("unexpected"); },
  });
  const result = await adapter.getSnapshot(contentTask);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [["article", "articles/example.html"]]);
  const report = handleReadOnlyTask(contentTask, result.snapshot);
  assert.equal(report.status, "attention");
  assert.equal(report.findings[0].code, "article_content_short");
  assert.deepEqual(result.sideEffects, []);
  assert.equal(result.execution, "not_started");
});

test("AI Bank adapter reads the catalog and detects duplicate official website", async () => {
  const adapter = createReadOnlyTaskSnapshotAdapter({
    async readArticleHtml() { throw new Error("unexpected"); },
    async readAiBankCatalog() { return catalog; },
    async readSeoPage() { throw new Error("unexpected"); },
  });
  const result = await adapter.getSnapshot(bankTask);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.duplicateId, "duplicate-ai");
  const report = handleReadOnlyTask(bankTask, result.snapshot);
  assert.equal(report.status, "review_required");
  assert.equal(report.findings[0].code, "candidate_duplicate");
});

test("SEO adapter requires explicit sitemap and broken-link evidence", async () => {
  const adapter = createReadOnlyTaskSnapshotAdapter({
    async readArticleHtml() { throw new Error("unexpected"); },
    async readAiBankCatalog() { throw new Error("unexpected"); },
    async readSeoPage(path) {
      assert.equal(path, "/articles/example");
      return { html, statusCode: 200, sitemapIncluded: true, brokenInternalLinkCount: 0 };
    },
  });
  const result = await adapter.getSnapshot(seoTask);
  assert.equal(result.ok, true);
  const report = handleReadOnlyTask(seoTask, result.snapshot);
  assert.equal(report.status, "pass");
});

test("invalid tasks are rejected before invoking any source reader", async () => {
  let calls = 0;
  const adapter = createReadOnlyTaskSnapshotAdapter({
    async readArticleHtml() { calls++; return html; },
    async readAiBankCatalog() { calls++; return catalog; },
    async readSeoPage() { calls++; return { html, statusCode: 200, sitemapIncluded: true, brokenInternalLinkCount: 0 }; },
  });
  const result = await adapter.getSnapshot({
    type: "content.review",
    idempotencyKey: key,
    payload: { articlePath: "../../secrets" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "task_invalid:article_path_invalid");
  assert.equal(calls, 0);
});

test("source exceptions and oversized or malformed snapshots fail closed", async () => {
  const adapter = createReadOnlyTaskSnapshotAdapter({
    async readArticleHtml() { throw new Error("private source error"); },
    async readAiBankCatalog() { return { tools: "not-an-array" }; },
    async readSeoPage() { return { html: "<html></html>", statusCode: 200, sitemapIncluded: "yes", brokenInternalLinkCount: 0 }; },
  });
  assert.equal((await adapter.getSnapshot(contentTask)).error, "read_only_source_error");
  assert.equal((await adapter.getSnapshot(bankTask)).error, "candidate_source_unavailable");
  assert.equal((await adapter.getSnapshot(seoTask)).error, "seo_source_unavailable");

  const large = createReadOnlyTaskSnapshotAdapter({
    async readArticleHtml() { return "x".repeat(TASK_SNAPSHOT_ADAPTER_LIMITS.maxSourceBytes + 1); },
    async readAiBankCatalog() { return catalog; },
    async readSeoPage() { return { html, statusCode: 200, sitemapIncluded: true, brokenInternalLinkCount: 0 }; },
  });
  assert.equal((await large.getSnapshot(contentTask)).error, "article_source_unavailable");
});

test("reader interface is mandatory and source bounds are explicit", () => {
  assert.throws(() => createReadOnlyTaskSnapshotAdapter({}), /read_only_readers_required/);
  assert.equal(TASK_SNAPSHOT_ADAPTER_LIMITS.maxSourceBytes, 512 * 1024);
  assert.equal(TASK_SNAPSHOT_ADAPTER_LIMITS.maxCatalogItems, 1000);
});
