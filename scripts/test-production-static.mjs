import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const output = path.join(process.cwd(), "production-output");
assert.ok((await stat(output)).isDirectory(), "run build-production-static.mjs first");
async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(full));
    else if (item.isFile()) files.push(full);
  }
  return files;
}
const html = (await walk(output)).filter(f => f.endsWith(".html"));
const articles = html.filter(f => f.includes(path.sep + "articles" + path.sep));
assert.equal(articles.length, 69);
for (const file of articles) {
  const text = await readFile(file, "utf8");
  assert.match(text, /name="robots" content="index,follow,max-image-preview:large"/i);
  assert.match(text, /rel="canonical" href="https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/articles\//i);
  assert.match(text, /name="author" content="DUNG - AI"/i);
  assert.match(text, /DUNG - AI/);
  const robotsTag = text.match(/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*>/i)?.[0] || "";
  assert.ok(robotsTag);
  assert.doesNotMatch(robotsTag, /noindex/i);
  const metadata = [
    ...text.matchAll(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi),
    ...text.matchAll(/<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>/gi),
    ...text.matchAll(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi)
  ].map(match => match[0]).join("\n");
  assert.doesNotMatch(metadata, /\.pages\.dev|ai-thuc-chien-blog-auth-app-preview/i);
  assert.doesNotMatch(text, /id=["']preview-api-guard["']/i);
}
const index = await readFile(path.join(output, "index.html"), "utf8");
assert.match(index, /Khám phá.*69 bài thực hành/s);
assert.match(index, /rel="canonical" href="https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\//);
const bank = await readFile(path.join(output, "ngan-hang-ai.html"), "utf8");
assert.match(bank, /Ngân hàng/);
assert.match(bank, /rel="canonical" href="https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/ngan-hang-ai\.html"/);
const catalog = JSON.parse(await readFile(path.join(output, "data", "ai-tools.json"), "utf8"));
assert.equal(catalog.tools.length, 27);
assert.equal(catalog.tools.filter(t => t.verification_status === "needs_review").length, 4);
const flowise = catalog.tools.find(t => t.id === "flowise");
assert.equal(flowise?.status, "deprecated");
assert.equal(flowise?.verification_status, "needs_review");
assert.equal(flowise?.pricing_model, "unknown");
assert.equal(flowise?.pricing_status, "unknown");
const headers = await readFile(path.join(output, "_headers"), "utf8");
assert.doesNotMatch(headers, /noindex/i);
assert.match(headers, /X-Content-Type-Options: nosniff/);
const sitemap = await readFile(path.join(output, "sitemap.xml"), "utf8");
assert.equal((sitemap.match(/<url>/g) || []).length, 73);
console.log("PASS production output contract and all 69 article metadata checks");
