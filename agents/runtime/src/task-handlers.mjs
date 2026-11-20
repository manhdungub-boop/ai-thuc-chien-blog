import { validateTaskRequest } from "./task-contract.mjs";

const MAX_SNAPSHOT_BYTES = 16 * 1024;
const MAX_FINDINGS = 20;

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
}

function safeText(value, max = 2048, allowEmpty = false) {
  return typeof value === "string" &&
    value.length <= max &&
    (allowEmpty || value.trim().length > 0) &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validHttpsUrl(value) {
  if (!safeText(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function snapshotSize(snapshot) {
  try {
    return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  } catch {
    return Infinity;
  }
}

function finding(code, severity, message) {
  return Object.freeze({ code, severity, message });
}

function buildReport(taskType, findings) {
  const bounded = findings.slice(0, MAX_FINDINGS).sort((a, b) =>
    a.code.localeCompare(b.code));
  return Object.freeze({
    ok: true,
    mode: "read_only_analysis",
    execution: "not_started",
    taskType,
    status: bounded.some((item) => item.severity === "error") ? "review_required" :
      bounded.length ? "attention" : "pass",
    findingCount: bounded.length,
    findings: Object.freeze(bounded),
    sideEffects: Object.freeze([]),
  });
}

function validateContentSnapshot(task, snapshot) {
  const keys = [
    "articlePath", "title", "description", "canonicalUrl", "author",
    "hasBlogPostingJsonLd", "hasAttributionNote", "wordCount", "internalLinkCount",
  ];
  if (!exactKeys(snapshot, keys)) return null;
  if (snapshot.articlePath !== task.payload.articlePath ||
      !safeText(snapshot.articlePath, 170) ||
      !safeText(snapshot.title, 300, true) ||
      !safeText(snapshot.description, 600, true) ||
      !safeText(snapshot.author, 120, true) ||
      !validHttpsUrl(snapshot.canonicalUrl) ||
      typeof snapshot.hasBlogPostingJsonLd !== "boolean" ||
      typeof snapshot.hasAttributionNote !== "boolean" ||
      !Number.isSafeInteger(snapshot.wordCount) || snapshot.wordCount < 0 || snapshot.wordCount > 100000 ||
      !Number.isSafeInteger(snapshot.internalLinkCount) || snapshot.internalLinkCount < 0 || snapshot.internalLinkCount > 10000) {
    return null;
  }

  const findings = [];
  if (!snapshot.title) findings.push(finding("article_title_missing", "error", "Bài viết chưa có tiêu đề."));
  if (snapshot.description.length < 50) findings.push(finding("article_description_short", "warning", "Mô tả bài viết còn thiếu hoặc quá ngắn."));
  if (snapshot.author !== "DUNG - AI") findings.push(finding("article_author_mismatch", "error", "Thông tin tác giả chưa khớp quy chuẩn DUNG - AI."));
  if (!snapshot.hasBlogPostingJsonLd) findings.push(finding("article_jsonld_missing", "error", "Thiếu dữ liệu cấu trúc BlogPosting hợp lệ."));
  if (!snapshot.hasAttributionNote) findings.push(finding("article_attribution_missing", "error", "Thiếu ghi chú ghi công và điều kiện tái sử dụng."));
  if (snapshot.wordCount < 500) findings.push(finding("article_content_short", "warning", "Bài viết có dung lượng ngắn; cần biên tập viên đánh giá độ đầy đủ."));
  if (snapshot.internalLinkCount === 0) findings.push(finding("article_internal_links_missing", "warning", "Chưa phát hiện liên kết nội bộ."));
  return buildReport("content.review", findings);
}

function validateCandidateSnapshot(task, snapshot) {
  const keys = [
    "candidateId", "name", "vendor", "website", "officialSources",
    "pricingModel", "pricingStatus", "lastVerified", "verificationStatus", "duplicateId",
  ];
  if (!exactKeys(snapshot, keys)) return null;
  if (snapshot.candidateId !== task.payload.candidateId ||
      !safeText(snapshot.candidateId, 80) ||
      !safeText(snapshot.name, 160, true) ||
      !safeText(snapshot.vendor, 160, true) ||
      !safeText(snapshot.pricingModel, 60, true) ||
      !safeText(snapshot.pricingStatus, 60, true) ||
      !safeText(snapshot.verificationStatus, 40, true) ||
      !(snapshot.duplicateId === null || safeText(snapshot.duplicateId, 80)) ||
      !Array.isArray(snapshot.officialSources) || snapshot.officialSources.length > 20 ||
      snapshot.officialSources.some((url) => !validHttpsUrl(url)) ||
      !(snapshot.website === "" || validHttpsUrl(snapshot.website)) ||
      !(snapshot.lastVerified === "" || validDate(snapshot.lastVerified))) {
    return null;
  }

  const findings = [];
  if (!snapshot.name || !snapshot.vendor) findings.push(finding("candidate_identity_incomplete", "error", "Thiếu tên công cụ hoặc nhà cung cấp."));
  if (!snapshot.website) findings.push(finding("candidate_website_missing", "error", "Chưa có website chính thức."));
  if (snapshot.officialSources.length === 0) findings.push(finding("candidate_sources_missing", "error", "Chưa có nguồn chính thức để đối chiếu."));
  if (!snapshot.pricingModel || !snapshot.pricingStatus) findings.push(finding("candidate_pricing_unknown", "warning", "Chưa xác minh mô hình giá và trạng thái gói miễn phí."));
  if (!snapshot.lastVerified || !snapshot.verificationStatus || snapshot.verificationStatus !== "verified") {
    findings.push(finding("candidate_verification_required", "warning", "Bản ghi cần được xác minh trước khi công bố."));
  }
  if (snapshot.duplicateId !== null) findings.push(finding("candidate_duplicate", "error", "Ứng viên có dấu hiệu trùng với bản ghi hiện có."));
  return buildReport("ai_bank.candidate_review", findings);
}

function validateSeoSnapshot(task, snapshot) {
  const keys = [
    "path", "statusCode", "title", "description", "canonicalUrl",
    "robotsIndexable", "hasJsonLd", "sitemapIncluded",
    "internalLinkCount", "brokenInternalLinkCount",
  ];
  if (!exactKeys(snapshot, keys)) return null;
  if (snapshot.path !== task.payload.path ||
      !safeText(snapshot.path, 241) ||
      !Number.isSafeInteger(snapshot.statusCode) || snapshot.statusCode < 100 || snapshot.statusCode > 599 ||
      !safeText(snapshot.title, 300, true) ||
      !safeText(snapshot.description, 600, true) ||
      !(snapshot.canonicalUrl === "" || validHttpsUrl(snapshot.canonicalUrl)) ||
      typeof snapshot.robotsIndexable !== "boolean" ||
      typeof snapshot.hasJsonLd !== "boolean" ||
      typeof snapshot.sitemapIncluded !== "boolean" ||
      !Number.isSafeInteger(snapshot.internalLinkCount) || snapshot.internalLinkCount < 0 || snapshot.internalLinkCount > 10000 ||
      !Number.isSafeInteger(snapshot.brokenInternalLinkCount) || snapshot.brokenInternalLinkCount < 0 ||
      snapshot.brokenInternalLinkCount > snapshot.internalLinkCount) {
    return null;
  }

  const findings = [];
  if (snapshot.statusCode !== 200) findings.push(finding("seo_http_status", "error", "Trang không trả về HTTP 200."));
  if (!snapshot.title) findings.push(finding("seo_title_missing", "error", "Thiếu tiêu đề trang."));
  if (snapshot.description.length < 50) findings.push(finding("seo_description_short", "warning", "Meta description còn thiếu hoặc quá ngắn."));
  if (!snapshot.canonicalUrl) findings.push(finding("seo_canonical_missing", "error", "Thiếu canonical URL."));
  if (!snapshot.robotsIndexable) findings.push(finding("seo_not_indexable", "error", "Trang đang bị cấu hình không cho lập chỉ mục."));
  if (!snapshot.hasJsonLd) findings.push(finding("seo_jsonld_missing", "warning", "Chưa phát hiện JSON-LD."));
  if (!snapshot.sitemapIncluded) findings.push(finding("seo_sitemap_missing", "error", "Trang chưa có trong sitemap."));
  if (snapshot.internalLinkCount === 0) findings.push(finding("seo_internal_links_missing", "warning", "Chưa phát hiện liên kết nội bộ."));
  if (snapshot.brokenInternalLinkCount > 0) findings.push(finding("seo_broken_internal_links", "error", "Có liên kết nội bộ bị lỗi cần kiểm tra."));
  return buildReport("seo.audit", findings);
}

/**
 * Pure read-only analysis over a bounded metadata snapshot.
 * It performs no reads itself and cannot write, publish, call a provider, or dispatch work.
 * A future adapter must supply the snapshot using a separately reviewed read-only interface.
 */
export function handleReadOnlyTask(taskInput, snapshot) {
  const validation = validateTaskRequest(taskInput);
  if (!validation.ok) {
    return Object.freeze({
      ok: false,
      mode: "read_only_analysis",
      execution: "not_started",
      error: "task_invalid:" + validation.error,
      sideEffects: Object.freeze([]),
    });
  }
  if (!isRecord(snapshot) || snapshotSize(snapshot) > MAX_SNAPSHOT_BYTES) {
    return Object.freeze({
      ok: false,
      mode: "read_only_analysis",
      execution: "not_started",
      error: "snapshot_invalid",
      sideEffects: Object.freeze([]),
    });
  }

  let report = null;
  if (validation.task.type === "content.review") report = validateContentSnapshot(validation.task, snapshot);
  if (validation.task.type === "ai_bank.candidate_review") report = validateCandidateSnapshot(validation.task, snapshot);
  if (validation.task.type === "seo.audit") report = validateSeoSnapshot(validation.task, snapshot);

  return report || Object.freeze({
    ok: false,
    mode: "read_only_analysis",
    execution: "not_started",
    error: "snapshot_schema_invalid",
    sideEffects: Object.freeze([]),
  });
}

export const READ_ONLY_HANDLER_LIMITS = Object.freeze({
  maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
  maxFindings: MAX_FINDINGS,
  taskTypes: Object.freeze([
    "content.review",
    "ai_bank.candidate_review",
    "seo.audit",
  ]),
});
