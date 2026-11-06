import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const articleDir = join(root, "articles");
const articleFiles = (await readdir(articleDir)).filter((name) => name.endsWith(".html")).sort();
assert.equal(articleFiles.length, 69, `Expected 69 article pages; found ${articleFiles.length}`);

const sitemap = await readFile(join(root, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((m) => m[1].trim());
assert.equal(sitemapUrls.length, 73, `Expected 73 sitemap URLs; found ${sitemapUrls.length}`);
assert.equal(new Set(sitemapUrls).size, sitemapUrls.length, "Sitemap contains duplicate URLs");

const base = "https://ai-thuc-chien-blog.manhdungub.workers.dev";
const sitemapSet = new Set(sitemapUrls);
for (const file of articleFiles) {
  const slug = file.replace(/\.html$/, "");
  const html = await readFile(join(articleDir, file), "utf8");
  const canonical = `${base}/articles/${slug}`;
  assert.match(html, /<title>[^<]+<\/title>/i, `${file}: title missing`);
  assert.match(html, /<meta\s+name="description"\s+content="[^"]+"/i, `${file}: description missing`);
  assert.match(html, /<meta\s+name="robots"\s+content="index,follow/i, `${file}: indexability metadata missing`);
  assert.match(html, /<meta\s+name="author"\s+content="DUNG - AI"/i, `${file}: author metadata must be DUNG - AI`);
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`), `${file}: canonical URL mismatch`);
  assert.match(html, /class="article-(?:attribution|author-note)"/i, `${file}: author attribution section missing`);
  assert.ok(html.includes("DUNG - AI"), `${file}: author attribution missing`);
  assert.ok(sitemapSet.has(canonical), `${file}: canonical URL missing from sitemap`);
}

for (const path of ["index.html", "ve-chung-toi.html", "thu-vien.html", "ngan-hang-ai.html"]) {
  const html = await readFile(join(root, path), "utf8");
  assert.match(html, /<meta\s+name="author"\s+content="DUNG - AI"/i, `${path}: author metadata must be DUNG - AI`);
}

for (const path of ["index.html", "ve-chung-toi.html", "thu-vien.html", "ngan-hang-ai.html", "styles.css", "script.js", "favicon.svg", "logo.svg", "robots.txt", "feed.xml", "data/ai-tools.json"]) {
  await access(join(root, path));
}
const tools = JSON.parse(await readFile(join(root, "data/ai-tools.json"), "utf8"));
assert.ok(Array.isArray(tools) || (tools && typeof tools === "object"), "AI tools data must be a JSON array or object");
assert.ok(sitemapSet.has(`${base}/`), "Homepage missing from sitemap");
assert.ok(sitemapSet.has(`${base}/thu-vien.html`), "Library missing from sitemap");
assert.ok(sitemapSet.has(`${base}/ngan-hang-ai.html`), "AI tools directory missing from sitemap");
const catalog = JSON.parse(await readFile(join(root, "data", "ai-tools.json"), "utf8"));
const flowise = catalog.tools.find((tool) => tool.id === "flowise");
assert.equal(flowise?.status, "deprecated", "Flowise must be marked deprecated after its official sunset.");
assert.equal(flowise?.verification_status, "needs_review", "Flowise must not remain marked verified after sunset.");
assert.equal(flowise?.pricing_model, "unknown", "Flowise hosted pricing must not be asserted without current verification.");
assert.equal(flowise?.pricing_status, "unknown", "Flowise hosted pricing status must remain unknown.");


console.log("PASS: 69 article files");
console.log("PASS: 73 unique sitemap URLs");
console.log("PASS: per-article title, description, indexability, author, canonical, attribution and sitemap coverage");
console.log("PASS: static entry points, assets, RSS and AI tools JSON");
