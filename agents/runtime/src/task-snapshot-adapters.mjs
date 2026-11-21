import { validateTaskRequest } from "./task-contract.mjs";

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_CATALOG_ITEMS = 1000;

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function boundedHtml(value) {
  return typeof value === "string" && byteLength(value) <= MAX_SOURCE_BYTES;
}

function decodeEntities(value) {
  return value.replace(/&(?:nbsp|amp|quot|lt|gt|apos|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === "&nbsp;") return " ";
    if (normalized === "&amp;") return "&";
    if (normalized === "&quot;") return '"';
    if (normalized === "&apos;" || normalized === "&#39;") return "'";
    if (normalized === "&lt;") return "<";
    if (normalized === "&gt;") return ">";
    const code = normalized.startsWith("&#x")
      ? Number.parseInt(normalized.slice(3, -1), 16)
      : Number(normalized.slice(2, -1));
    return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff &&
      !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : " ";
  });
}

function attributes(tag) {
  const result = Object.create(null);
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function firstMeta(html, name) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if ((attrs.name || "").toLowerCase() === name.toLowerCase()) return attrs.content || "";
  }
  return "";
}

function canonicalUrl(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if ((attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical")) return attrs.href || "";
  }
  return "";
}

function titleText(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return match ? decodeEntities(match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()) : "";
}

function visibleText(html) {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function countInternalLinks(html) {
  let count = 0;
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attributes(match[0]).href || "";
    if (href && !href.startsWith("#") && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) count++;
  }
  return count;
}

function hasBlogPostingJsonLd(html) {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      const records = Array.isArray(data) ? data : [data];
      if (records.some((record) => record && record["@type"] === "BlogPosting")) return true;
    } catch {
      // Invalid structured data is not treated as valid evidence.
    }
  }
  return false;
}

function hasAttributionNote(html) {
  return /<section\b[^>]*class=["'][^"']*\barticle-author-note\b[^"']*["'][\s\S]*?<\/section>/i.test(html) ||
    /bài viết gốc[\s\S]{0,500}(?:liên kết về bài viết|DUNG\s*-\s*AI)/i.test(html);
}

function articleSnapshot(articlePath, html) {
  const text = visibleText(html);
  return {
    articlePath,
    title: titleText(html),
    description: firstMeta(html, "description"),
    canonicalUrl: canonicalUrl(html),
    author: firstMeta(html, "author"),
    hasBlogPostingJsonLd: hasBlogPostingJsonLd(html),
    hasAttributionNote: hasAttributionNote(html),
    wordCount: text ? text.split(/\s+/).length : 0,
    internalLinkCount: countInternalLinks(html),
  };
}

function seoSnapshot(path, result) {
  if (!isRecord(result) || !boundedHtml(result.html) ||
      !Number.isSafeInteger(result.statusCode) ||
      typeof result.sitemapIncluded !== "boolean" ||
      !Number.isSafeInteger(result.brokenInternalLinkCount) ||
      result.brokenInternalLinkCount < 0) return null;
  const html = result.html;
  return {
    path,
    statusCode: result.statusCode,
    title: titleText(html),
    description: firstMeta(html, "description"),
    canonicalUrl: canonicalUrl(html),
    robotsIndexable: !/(?:^|[,\s])(?:noindex|none)(?:$|[,\s])/i.test(firstMeta(html, "robots")),
    hasJsonLd: hasBlogPostingJsonLd(html),
    sitemapIncluded: result.sitemapIncluded,
    internalLinkCount: countInternalLinks(html),
    brokenInternalLinkCount: result.brokenInternalLinkCount,
  };
}

function candidateSnapshot(candidateId, catalog) {
  if (!isRecord(catalog) || !Array.isArray(catalog.tools) ||
      catalog.tools.length > MAX_CATALOG_ITEMS ||
      byteLength(JSON.stringify(catalog)) > MAX_SOURCE_BYTES) return null;
  const tools = catalog.tools;
  const candidate = tools.find((item) => isRecord(item) && item.id === candidateId);
  if (!candidate) return null;
  const normalizedWebsite = (value) => {
    try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { return ""; }
  };
  const nameKey = (value) => typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") : "";
  const websiteKey = normalizedWebsite(candidate.website);
  const duplicate = tools.find((item) => item !== candidate && isRecord(item) &&
    ((websiteKey && normalizedWebsite(item.website) === websiteKey) ||
     (nameKey(candidate.name) && nameKey(item.name) === nameKey(candidate.name))));
  return {
    candidateId,
    name: typeof candidate.name === "string" ? candidate.name : "",
    vendor: typeof candidate.vendor === "string" ? candidate.vendor : "",
    website: typeof candidate.website === "string" ? candidate.website : "",
    officialSources: Array.isArray(candidate.official_sources) ? candidate.official_sources : [],
    pricingModel: typeof candidate.pricing_model === "string" ? candidate.pricing_model : "",
    pricingStatus: typeof candidate.pricing_status === "string" ? candidate.pricing_status : "",
    lastVerified: typeof candidate.last_verified === "string" ? candidate.last_verified : "",
    verificationStatus: typeof candidate.verification_status === "string" ? candidate.verification_status : "",
    duplicateId: duplicate && typeof duplicate.id === "string" ? duplicate.id : null,
  };
}

function unavailable(reason) {
  return Object.freeze({
    ok: false,
    mode: "read_only_snapshot",
    execution: "not_started",
    error: reason,
    sideEffects: Object.freeze([]),
  });
}

/**
 * Builds snapshots from injected, read-only source functions.
 * No filesystem, network, Worker binding, write API, or global fetch is used here.
 * The host must provide narrowly scoped readers and must not expose write capabilities.
 */
export function createReadOnlyTaskSnapshotAdapter(readers) {
  if (!isRecord(readers) ||
      typeof readers.readArticleHtml !== "function" ||
      typeof readers.readAiBankCatalog !== "function" ||
      typeof readers.readSeoPage !== "function") {
    throw new TypeError("read_only_readers_required");
  }

  return Object.freeze({
    async getSnapshot(taskInput, { signal } = {}) {
      if (signal?.aborted) throw new Error("task_execution_aborted");
      const validation = validateTaskRequest(taskInput);
      if (!validation.ok) return unavailable("task_invalid:" + validation.error);
      const task = validation.task;
      try {
        if (task.type === "content.review") {
          const html = await readers.readArticleHtml(task.payload.articlePath, { signal });
          if (signal?.aborted) throw new Error("task_execution_aborted");
          if (!boundedHtml(html)) return unavailable("article_source_unavailable");
          return Object.freeze({
            ok: true,
            mode: "read_only_snapshot",
            execution: "not_started",
            snapshot: Object.freeze(articleSnapshot(task.payload.articlePath, html)),
            sideEffects: Object.freeze([]),
          });
        }
        if (task.type === "ai_bank.candidate_review") {
          const catalog = await readers.readAiBankCatalog({ signal });
          if (signal?.aborted) throw new Error("task_execution_aborted");
          const snapshot = candidateSnapshot(task.payload.candidateId, catalog);
          if (!snapshot) return unavailable("candidate_source_unavailable");
          return Object.freeze({
            ok: true,
            mode: "read_only_snapshot",
            execution: "not_started",
            snapshot: Object.freeze(snapshot),
            sideEffects: Object.freeze([]),
          });
        }
        if (task.type === "seo.audit") {
          const result = await readers.readSeoPage(task.payload.path, { signal });
          if (signal?.aborted) throw new Error("task_execution_aborted");
          const snapshot = seoSnapshot(task.payload.path, result);
          if (!snapshot) return unavailable("seo_source_unavailable");
          return Object.freeze({
            ok: true,
            mode: "read_only_snapshot",
            execution: "not_started",
            snapshot: Object.freeze(snapshot),
            sideEffects: Object.freeze([]),
          });
        }
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw new Error("task_execution_aborted");
        return unavailable("read_only_source_error");
      }
      return unavailable("task_type_not_allowed");
    },
  });
}

export const TASK_SNAPSHOT_ADAPTER_LIMITS = Object.freeze({
  maxSourceBytes: MAX_SOURCE_BYTES,
  maxCatalogItems: MAX_CATALOG_ITEMS,
});
