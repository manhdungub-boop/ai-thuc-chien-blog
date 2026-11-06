import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const output = path.join(process.cwd(), "production-output");
assert.ok((await stat(output)).isDirectory(), "Run build-production-pages.mjs first.");
const entries = (await readdir(output)).sort();
assert.deepEqual(entries, ["_headers","articles","data","favicon.svg","feed.xml","illustrations","images","index.html","logo.svg","ngan-hang-ai.html","robots.txt","script.js","sitemap.xml","styles.css","thu-vien.html","ve-chung-toi.html"]);
const htmlFiles = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full);
    else if (item.isFile() && full.endsWith(".html")) htmlFiles.push(full);
  }
}
await walk(output);
const articles = htmlFiles.filter(file => file.includes(path.sep + "articles" + path.sep));
assert.equal(articles.length, 69);
for (const file of articles) {
  const html = await readFile(file, "utf8");
  assert.match(html, /name=["']robots["'] content=["']index,follow/i);
  assert.match(html, /name=["']author["'] content=["']DUNG - AI["']/i);
  assert.match(html, /DUNG - AI/);
  const robotsTag = html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] || "";
  assert.ok(robotsTag, "Public article must contain a robots meta tag.");
  assert.doesNotMatch(robotsTag, /noindex/i);
}
const catalog = JSON.parse(await readFile(path.join(output, "data", "ai-tools.json"), "utf8"));
assert.equal(catalog.tools.length, 27);
const flowise = catalog.tools.find(tool => tool.id === "flowise");
assert.equal(flowise.status, "deprecated");
assert.equal(flowise.verification_status, "needs_review");
assert.equal(flowise.pricing_model, "unknown");
assert.equal(flowise.pricing_status, "unknown");
const headers = await readFile(path.join(output, "_headers"), "utf8");
assert.match(headers, /X-Content-Type-Options: nosniff/);
assert.match(headers, /X-Frame-Options: DENY/);
console.log("PASS production output contract, all 69 article metadata checks and Flowise sunset record.");
