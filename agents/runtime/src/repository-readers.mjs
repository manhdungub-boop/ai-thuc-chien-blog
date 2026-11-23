import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_HTML_BYTES = 512 * 1024;
const MAX_CATALOG_BYTES = 512 * 1024;
const MAX_SITEMAP_BYTES = 2 * 1024 * 1024;
const ARTICLE_PATH = /^articles\/[a-z0-9][a-z0-9-]{0,150}\.html$/;
const SITE_PATH = /^\/(?:[a-zA-Z0-9/_-]{0,240})$/;

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readBounded(file, limit) {
  const content = await readFile(file);
  if (content.byteLength > limit) throw new Error("repository_source_too_large");
  return content;
}

export function decodeXml(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === "&amp;") return "&";
    if (normalized === "&lt;") return "<";
    if (normalized === "&gt;") return ">";
    if (normalized === "&quot;") return '"';
    if (normalized === "&apos;") return "'";
    const code = normalized.startsWith("&#x")
      ? Number.parseInt(normalized.slice(3, -1), 16)
      : Number(normalized.slice(2, -1));
    return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff &&
      !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : " ";
  });
}

function sitemapPaths(xml) {
  const paths = new Set();
  for (const match of xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)) {
    try {
      const url = new URL(decodeXml(match[1]));
      if (url.protocol === "https:") paths.add(url.pathname.replace(/\/$/, "") || "/");
    } catch {
      // Ignore malformed sitemap locations; they are not evidence of inclusion.
    }
  }
  return paths;
}

function htmlFileForSitePath(sitePath) {
  if (!SITE_PATH.test(sitePath) || sitePath.includes("//") || sitePath.includes("..")) {
    throw new Error("site_path_invalid");
  }
  if (sitePath === "/") return "index.html";
  const article = sitePath.match(/^\/articles\/([a-z0-9][a-z0-9-]{0,150})$/);
  if (article) return `articles/${article[1]}.html`;
  if (/^\/[a-z0-9][a-z0-9-]{0,100}\.html$/.test(sitePath)) return sitePath.slice(1);
  throw new Error("site_path_not_allowlisted");
}

/**
 * Node-only repository reader for isolated CI/build inspection.
 * It is not imported by the Cloudflare Worker entrypoint.
 * SEO status/link counts must come from an explicit injected audit evidence provider.
 */
export async function createRepositoryReadOnlyReaders({ repositoryRoot, seoEvidenceReader } = {}) {
  if (typeof repositoryRoot !== "string" || !repositoryRoot.trim()) {
    throw new TypeError("repository_root_required");
  }
  if (typeof seoEvidenceReader !== "function") {
    throw new TypeError("seo_evidence_reader_required");
  }
  const root = await realpath(repositoryRoot);

  async function readInside(relativePath, limit) {
    const candidate = path.resolve(root, relativePath);
    if (!inside(root, candidate)) throw new Error("repository_path_outside_root");
    const actual = await realpath(candidate);
    if (!inside(root, actual)) throw new Error("repository_symlink_outside_root");
    return readBounded(actual, limit);
  }

  return Object.freeze({
    async readArticleHtml(articlePath) {
      if (typeof articlePath !== "string" || !ARTICLE_PATH.test(articlePath)) {
        throw new Error("article_path_invalid");
      }
      return (await readInside(articlePath, MAX_HTML_BYTES)).toString("utf8");
    },

    async readAiBankCatalog() {
      const bytes = await readInside("data/ai-tools.json", MAX_CATALOG_BYTES);
      const parsed = JSON.parse(bytes.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
          !Array.isArray(parsed.tools) || parsed.tools.length > 1000) {
        throw new Error("ai_bank_catalog_invalid");
      }
      return parsed;
    },

    async readSeoPage(sitePath) {
      const relativePath = htmlFileForSitePath(sitePath);
      const [htmlBytes, sitemapBytes, evidence] = await Promise.all([
        readInside(relativePath, MAX_HTML_BYTES),
        readInside("sitemap.xml", MAX_SITEMAP_BYTES),
        seoEvidenceReader(sitePath),
      ]);
      if (!evidence || typeof evidence !== "object" ||
          !Number.isSafeInteger(evidence.statusCode) ||
          !Number.isSafeInteger(evidence.brokenInternalLinkCount) ||
          evidence.brokenInternalLinkCount < 0) {
        throw new Error("seo_audit_evidence_invalid");
      }
      const included = sitemapPaths(sitemapBytes.toString("utf8")).has(sitePath.replace(/\/$/, "") || "/");
      return {
        html: htmlBytes.toString("utf8"),
        statusCode: evidence.statusCode,
        sitemapIncluded: included,
        brokenInternalLinkCount: evidence.brokenInternalLinkCount,
      };
    },
  });
}

export const REPOSITORY_READER_LIMITS = Object.freeze({
  maxHtmlBytes: MAX_HTML_BYTES,
  maxCatalogBytes: MAX_CATALOG_BYTES,
  maxSitemapBytes: MAX_SITEMAP_BYTES,
});
