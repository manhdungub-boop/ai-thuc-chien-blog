import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(repoRoot, "site-snapshot");

async function walk(dir) {
  const out = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...await walk(full));
    else if (item.isFile()) out.push(full);
  }
  return out;
}

function candidatePaths(rel) {
  const clean = path.posix.normalize(rel).replace(/^\/+/, "");
  if (!clean || clean === ".") return ["index.html"];
  if (clean.endsWith("/")) return [clean + "index.html"];
  if (path.posix.extname(clean)) return [clean];
  return [clean, clean + ".html"];
}

const allFiles = await walk(siteRoot);
const htmlFiles = allFiles.filter((f) => f.endsWith(".html"));
const articleFiles = allFiles.filter((f) => f.includes(path.sep + "articles" + path.sep) && f.endsWith(".html"));
assert.ok(allFiles.some((f) => f.endsWith(path.sep + "index.html")), "site snapshot must include index.html");
assert.ok(allFiles.some((f) => f.endsWith(path.sep + "script.js")), "site snapshot must include script.js");
assert.ok(allFiles.some((f) => f.endsWith(path.sep + "styles.css")), "site snapshot must include styles.css");
assert.ok(allFiles.some((f) => f.endsWith(path.sep + "logo.svg")), "site snapshot must include a high-resolution organization logo");
const logoSvg = await readFile(path.join(siteRoot, "logo.svg"), "utf8");
assert.match(logoSvg, /width="512"\s+height="512"/, "organization logo must declare at least 512x512 intrinsic dimensions");
assert.match(logoSvg, /viewBox="0 0 64 64"/, "organization logo must preserve the existing favicon's brand geometry");
const homepageHtml = await readFile(path.join(siteRoot, "index.html"), "utf8");
const libraryHtml = await readFile(path.join(siteRoot, "thu-vien.html"), "utf8");
const libraryDeclaredMatch = libraryHtml.match(/<title>\s*Thư viện\s+(\d+)\s+bài thực hành/i);
assert.ok(libraryDeclaredMatch, "library must declare its total article count in the title");
const libraryDeclaredCount = Number(libraryDeclaredMatch[1]);
const libraryArticleSlugs = new Set(
  [...libraryHtml.matchAll(/href=["']\/articles\/([^"']+)["']/g)].map((match) => match[1]),
);
assert.equal(libraryArticleSlugs.size, libraryDeclaredCount, "library declared total must equal unique article links");
const topicCounts = [...libraryHtml.matchAll(/<h2[^>]*>\s*(?:Công cụ AI|Tự động hóa|AI sáng tạo|AI kiếm tiền)\s*—\s*(\d+)\s*bài<\/h2>/gi)]
  .map((match) => Number(match[1]));
assert.equal(topicCounts.length, 4, "library must list all four topics with article counts");
const curatedCountMatch = libraryHtml.match(/(\d+)\s+bài theo lộ trình/i);
assert.ok(curatedCountMatch, "library must declare its curated learning-path count");
const curatedCount = Number(curatedCountMatch[1]);
const supplementaryCountMatch = libraryHtml.match(/<h2 id="deep-dive-title">\s*(\d+)\s+bài chuyên sâu bổ sung\s*<\/h2>/i);
assert.ok(supplementaryCountMatch, "library must declare the supplementary article count");
const supplementaryCount = Number(supplementaryCountMatch[1]);
assert.equal(topicCounts.reduce((sum, count) => sum + count, 0), curatedCount, "four topic counts must add up to the curated learning path");
assert.equal(curatedCount + supplementaryCount, libraryDeclaredCount, "curated and supplementary counts must add up to the full library total");
const homepageCountMatch = homepageHtml.match(/Khám phá\s*<em>(\d+)\s+bài thực hành/i);
assert.ok(homepageCountMatch, "homepage must show its linked library's article count");
assert.equal(Number(homepageCountMatch[1]), libraryDeclaredCount, "homepage article count must match the curated library");
assert.doesNotMatch(homepageHtml, /12 bài cho mỗi chủ đề/i, "homepage must not describe uneven topic counts as equal");

const featuredReportSlug = "/articles/bao-cao-tuan-google-sheets-voi-ai";
assert.ok(homepageHtml.includes('href="' + featuredReportSlug + '"'), "homepage must link directly to the reviewed weekly-report article");
assert.ok(homepageHtml.includes("Tạo báo cáo tuần từ Google Sheets với AI có kiểm chứng"), "homepage must expose the featured report title");
assert.ok(libraryArticleSlugs.has(featuredReportSlug.slice("/articles/".length)), "the featured report must remain in the curated library");
const feedXml = await readFile(path.join(siteRoot, "feed.xml"), "utf8");
assert.ok(feedXml.includes("https://ai-thuc-chien-blog.manhdungub.workers.dev" + featuredReportSlug), "RSS feed must include the featured report URL");
assert.ok(feedXml.includes("Tạo báo cáo tuần từ Google Sheets với AI có kiểm chứng | AI Thực Chiến"), "RSS feed must include the featured report title");


const homepageSchemaMatch = homepageHtml.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
assert.ok(homepageSchemaMatch, "homepage must contain valid Organization structured data");
const homepageSchema = JSON.parse(homepageSchemaMatch[1]);
const homepageOrganization = (homepageSchema["@graph"] || []).find((item) => item["@type"] === "Organization");
assert.ok(homepageOrganization, "homepage JSON-LD must include the Organization entity");
assert.equal(homepageOrganization.logo, "https://ai-thuc-chien-blog.manhdungub.workers.dev/logo.svg", "Organization logo must point to the canonical high-resolution asset");
assert.equal(htmlFiles.length, 73, "expected 73 HTML pages in the recovered snapshot");
assert.equal(articleFiles.length, 69, "expected 69 article pages in the recovered snapshot");

const sitemap = await readFile(path.join(siteRoot, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
assert.equal(sitemapUrls.length, 73, "expected 73 sitemap URLs");
const sitemapArticleSlugs = new Set(sitemapUrls
  .map((value) => new URL(value).pathname)
  .filter((pathname) => pathname.startsWith("/articles/"))
  .map((pathname) => pathname.slice("/articles/".length).replace(/\/$/, "")));
assert.equal(sitemapArticleSlugs.size, articleFiles.length, "sitemap must contain every article URL exactly once");
assert.deepEqual([...sitemapArticleSlugs].filter((slug) => !libraryArticleSlugs.has(slug)), [], "every sitemap article must be linked from the library");
assert.deepEqual([...libraryArticleSlugs].filter((slug) => !sitemapArticleSlugs.has(slug)), [], "every library article link must resolve to a sitemap article");
const missing = [];

for (const value of sitemapUrls) {
  const url = new URL(value);
  const rel = decodeURIComponent(url.pathname);
  if (!candidatePaths(rel).some((candidate) => {
    try {
      const full = path.join(siteRoot, candidate);
      return full.startsWith(siteRoot + path.sep) && true;
    } catch {
      return false;
    }
  })) {
    missing.push({ type: "sitemap", value });
    continue;
  }
  const exists = candidatePaths(rel).some((candidate) => {
    try {
      const full = path.join(siteRoot, candidate);
      return full.startsWith(siteRoot + path.sep) && allFiles.includes(full);
    } catch {
      return false;
    }
  });
  if (!exists) missing.push({ type: "sitemap", value });
}

for (const file of htmlFiles) {
  const relFile = path.relative(siteRoot, file).split(path.sep).join("/");
  const html = await readFile(file, "utf8");
  const jsonLdScripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => {
      try {
        return JSON.parse(match[1]);
      } catch (error) {
        throw new Error("invalid JSON-LD in " + relFile + ": " + error.message);
      }
    });
  if (relFile.startsWith("articles/")) {
    const schemaNodes = jsonLdScripts.flatMap((schema) => {
      if (Array.isArray(schema)) return schema;
      if (Array.isArray(schema["@graph"])) return schema["@graph"];
      return [schema];
    });
    const blogPosting = schemaNodes.find((node) => node && node["@type"] === "BlogPosting");
    assert.ok(blogPosting, "article must include BlogPosting structured data: " + relFile);
    assert.equal(
      blogPosting.publisher?.logo,
      "https://ai-thuc-chien-blog.manhdungub.workers.dev/logo.svg",
      "article publisher must point to the canonical organization logo: " + relFile,
    );
  }
  const attrs = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
  let match;
  while ((match = attrs.exec(html)) !== null) {
    const href = match[2].trim();
    if (!href || href.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, "https://snapshot.invalid/" + relFile);
    } catch {
      missing.push({ type: "invalid-link", file: relFile, href });
      continue;
    }
    if (url.hostname !== "snapshot.invalid") continue;
    const decoded = decodeURIComponent(url.pathname);
    const relTarget = decoded.startsWith("/")
      ? decoded.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(relFile), decoded));
    const found = candidatePaths(relTarget).some((candidate) => {
      const full = path.join(siteRoot, candidate);
      return full.startsWith(siteRoot + path.sep) && allFiles.includes(full);
    });
    if (!found) missing.push({ type: "local-link", file: relFile, href });
  }
}

assert.deepEqual(missing, [], "all sitemap entries and local HTML links must resolve");
console.log("PASS static snapshot inventory: " + allFiles.length + " files");
console.log("PASS HTML pages: " + htmlFiles.length + "; articles: " + articleFiles.length);
console.log("PASS sitemap URLs: " + sitemapUrls.length);
console.log("PASS local HTML href/src links resolve");
console.log("PASS homepage Organization and all article publisher logos reference the canonical 512x512 logo asset");
