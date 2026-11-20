import test from "node:test";
import assert from "node:assert/strict";
import { handleReadOnlyTask, READ_ONLY_HANDLER_LIMITS } from "../src/task-handlers.mjs";

const key = "task-2026-11-20-000001";
const tasks = {
  content: { type: "content.review", idempotencyKey: key, payload: { articlePath: "articles/example.html" } },
  bank: { type: "ai_bank.candidate_review", idempotencyKey: key, payload: { candidateId: "candidate_123" } },
  seo: { type: "seo.audit", idempotencyKey: key, payload: { path: "/articles/example" } },
};
const contentSnapshot = (overrides = {}) => ({
  articlePath: "articles/example.html",
  title: "Hướng dẫn thực hành AI",
  description: "Hướng dẫn chi tiết về cách ứng dụng AI trong công việc hằng ngày.",
  canonicalUrl: "https://example.com/articles/example",
  author: "DUNG - AI",
  hasBlogPostingJsonLd: true,
  hasAttributionNote: true,
  wordCount: 1200,
  internalLinkCount: 3,
  ...overrides,
});
const bankSnapshot = (overrides = {}) => ({
  candidateId: "candidate_123",
  name: "Example AI",
  vendor: "Example Inc",
  website: "https://example.com/",
  officialSources: ["https://example.com/pricing"],
  pricingModel: "freemium",
  pricingStatus: "verified_free_tier",
  lastVerified: "2026-11-20",
  verificationStatus: "verified",
  duplicateId: null,
  ...overrides,
});
const seoSnapshot = (overrides = {}) => ({
  path: "/articles/example",
  statusCode: 200,
  title: "Hướng dẫn thực hành AI",
  description: "Hướng dẫn chi tiết về cách ứng dụng AI trong công việc hằng ngày.",
  canonicalUrl: "https://example.com/articles/example",
  robotsIndexable: true,
  hasJsonLd: true,
  sitemapIncluded: true,
  internalLinkCount: 4,
  brokenInternalLinkCount: 0,
  ...overrides,
});

test("content review returns a deterministic pass report without side effects", () => {
  const report = handleReadOnlyTask(tasks.content, contentSnapshot());
  assert.equal(report.ok, true);
  assert.equal(report.status, "pass");
  assert.equal(report.taskType, "content.review");
  assert.deepEqual(report.sideEffects, []);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.findings), true);
});

test("content review flags author, attribution and metadata defects", () => {
  const report = handleReadOnlyTask(tasks.content, contentSnapshot({
    author: "Unknown",
    hasAttributionNote: false,
    hasBlogPostingJsonLd: false,
    description: "",
  }));
  assert.equal(report.status, "review_required");
  assert.deepEqual(report.findings.map(item => item.code), [
    "article_attribution_missing",
    "article_author_mismatch",
    "article_description_short",
    "article_jsonld_missing",
  ]);
});

test("AI Bank candidate review requires official evidence and uniqueness", () => {
  const report = handleReadOnlyTask(tasks.bank, bankSnapshot({
    officialSources: [],
    verificationStatus: "needs_review",
    lastVerified: "",
    duplicateId: "existing_tool",
  }));
  assert.equal(report.status, "review_required");
  assert.deepEqual(report.findings.map(item => item.code), [
    "candidate_duplicate",
    "candidate_sources_missing",
    "candidate_verification_required",
  ]);
});

test("AI Bank candidate with verified evidence passes", () => {
  const report = handleReadOnlyTask(tasks.bank, bankSnapshot());
  assert.equal(report.status, "pass");
  assert.equal(report.findingCount, 0);
});

test("SEO audit identifies indexability, canonical, sitemap and broken-link defects", () => {
  const report = handleReadOnlyTask(tasks.seo, seoSnapshot({
    statusCode: 503,
    canonicalUrl: "",
    robotsIndexable: false,
    hasJsonLd: false,
    sitemapIncluded: false,
    brokenInternalLinkCount: 2,
  }));
  assert.equal(report.status, "review_required");
  assert.deepEqual(report.findings.map(item => item.code), [
    "seo_broken_internal_links",
    "seo_canonical_missing",
    "seo_http_status",
    "seo_jsonld_missing",
    "seo_not_indexable",
    "seo_sitemap_missing",
  ]);
});

test("SEO audit clean snapshot passes", () => {
  const report = handleReadOnlyTask(tasks.seo, seoSnapshot());
  assert.equal(report.status, "pass");
  assert.equal(report.findingCount, 0);
});

test("rejects unknown task, mismatched resource identity and extra snapshot fields", () => {
  assert.equal(handleReadOnlyTask({ type: "shell.exec" }, {}).error.startsWith("task_invalid:"), true);
  assert.equal(handleReadOnlyTask(tasks.content, contentSnapshot({ articlePath: "articles/other.html" })).error, "snapshot_schema_invalid");
  assert.equal(handleReadOnlyTask(tasks.content, { ...contentSnapshot(), rawHtml: "<script>" }).error, "snapshot_schema_invalid");
});

test("rejects unsafe URLs, malformed dates, invalid counters and oversized snapshots", () => {
  assert.equal(handleReadOnlyTask(tasks.content, contentSnapshot({ canonicalUrl: "http://example.com/" })).error, "snapshot_schema_invalid");
  assert.equal(handleReadOnlyTask(tasks.bank, bankSnapshot({ lastVerified: "2026-02-30" })).error, "snapshot_schema_invalid");
  assert.equal(handleReadOnlyTask(tasks.seo, seoSnapshot({ brokenInternalLinkCount: 5 })).error, "snapshot_schema_invalid");
  assert.equal(handleReadOnlyTask(tasks.seo, { ...seoSnapshot(), padding: "x".repeat(17000) }).error, "snapshot_invalid");
});

test("limits are explicit and bounded", () => {
  assert.deepEqual(READ_ONLY_HANDLER_LIMITS.taskTypes, [
    "content.review",
    "ai_bank.candidate_review",
    "seo.audit",
  ]);
  assert.equal(READ_ONLY_HANDLER_LIMITS.maxSnapshotBytes, 16 * 1024);
  assert.equal(READ_ONLY_HANDLER_LIMITS.maxFindings, 20);
});
