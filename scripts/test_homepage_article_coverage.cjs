const fs = require("node:fs");
const { URL } = require("node:url");

const homepage = fs.readFileSync("index.html", "utf8");
const library = fs.readFileSync("thu-vien.html", "utf8");
const sitemap = fs.readFileSync("sitemap.xml", "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1].trim());
const articleUrls = sitemapUrls.filter((value) => {
  try { return new URL(value).pathname.startsWith("/articles/"); }
  catch { return false; }
});
const discoveryHrefs = [homepage, library].flatMap((page) =>
  [...page.matchAll(/\bhref=["']([^"']+)["']/gi)].map((m) => m[1])
);
const normalizePath = (value) => {
  let path;
  try { path = new URL(value, "https://example.test").pathname; }
  catch { return ""; }
  path = decodeURIComponent(path).replace(/\.html$/i, "").replace(/\/$/, "");
  return path || "/";
};
const linkedPaths = new Set(discoveryHrefs.map(normalizePath));
const missing = articleUrls.filter((value) => !linkedPaths.has(normalizePath(value)));
if (articleUrls.length === 0) {
  console.error("FAIL: sitemap contains no article URLs");
  process.exit(1);
}
if (missing.length > 0) {
  console.error("FAIL: sitemap articles are not linked from the homepage:");
  for (const url of missing) console.error(` - ${url}`);
  process.exit(1);
}
console.log(`ARTICLE DISCOVERY PASS: all ${articleUrls.length} sitemap articles are discoverable from the homepage or topic library`);
