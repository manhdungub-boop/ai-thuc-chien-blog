import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { renderDraftMarkdown } from "./draft-markdown-renderer.mjs";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const markdownFixture = renderDraftMarkdown([
  "# Markdown renderer fixture",
  "",
  "- Parent item",
  "  - Nested item",
  "- [ ] Unchecked task",
  "- [x] Checked task",
  "",
  "| Name | Value |",
  "| --- | ---: |",
  "| A | 1 |",
  "",
  "<script>alert(1)</script>",
  "",
  "[Unsafe](javascript:alert(1))",
  "",
  "![Remote image](https://example.invalid/tracker.svg)",
  "",
  "[Official source](https://example.com/docs)"
].join("\n"));
assert.ok((markdownFixture.match(/<ul>/g) || []).length >= 2, "nested lists must render correctly");
assert.ok(markdownFixture.includes('type="checkbox"'), "GFM task lists must render as checkboxes");
assert.ok(markdownFixture.includes("<table>"), "GFM tables must render");
assert.ok(markdownFixture.includes("&lt;script&gt;"), "raw HTML must be escaped");
assert.ok(!markdownFixture.includes("<script>alert(1)</script>"), "raw HTML must not execute");
assert.ok(!markdownFixture.toLowerCase().includes("javascript:"), "unsafe link protocols must be removed");
assert.ok(!markdownFixture.includes('src="https://example.invalid'), "external images must be blocked");
assert.ok(markdownFixture.includes('href="https://example.com/docs"'), "HTTPS references must remain clickable");

const run = spawnSync(process.execPath, ["scripts/build-draft-preview.mjs"], {cwd:root,encoding:"utf8"});
assert.equal(run.status,0,"build failed:\n"+run.stdout+"\n"+run.stderr);
const out = path.join(root,"draft-preview-output");
const index = await readFile(path.join(out,"index.html"),"utf8");
assert.ok(index.includes("8 bài viết"));
assert.ok(index.includes("noindex"));
const slugs = await readdir(path.join(out,"drafts"));
assert.equal(slugs.length,8,"exactly eight draft pages required");
let images = 0;
for (const slug of slugs) {
  const html = await readFile(path.join(out,"drafts",slug,"index.html"),"utf8");
  assert.ok(html.includes('name="robots" content="noindex,nofollow,noarchive"'));
  assert.ok(html.includes("DUNG - AI"));
  assert.ok(html.includes("BẢN NHÁP – CHƯA XUẤT BẢN"));
  const schemaBlocks = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]));
  assert.ok(schemaBlocks.some((value) => value["@context"] === "https://schema.org"),
    "draft page must include the exact schema.org JSON-LD context");
  assert.ok(html.includes("Nguồn"));
  assert.match(html,/ghi rõ tác giả|vui lòng ghi rõ tác giả/i);
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(function (m) { return m[0]; });
  assert.equal(scriptTags.length,1,"only the JSON-LD script element is allowed");
  assert.ok(scriptTags[0].includes('type="application/ld+json"'));
  const refs = [...html.matchAll(/src="([^"]+\.svg)"/g)].map(function (m) { assert.ok(m[1].startsWith("../../assets/"), slug + ": image must use a local relative path"); return path.basename(m[1]); });
  assert.ok(refs.length>=1,slug+": SVG missing");
  for (const asset of refs) await stat(path.join(out,"assets",asset));
  images += refs.length;
}
assert.equal(images,8,"one local SVG expected per draft");
const headers = await readFile(path.join(out,"_headers"),"utf8");
const robots = await readFile(path.join(out,"robots.txt"),"utf8");
assert.ok(headers.includes("X-Robots-Tag: noindex, nofollow, noarchive"));
assert.ok(headers.includes("Cache-Control: no-store"));
assert.ok(robots.includes("Disallow: /"));
console.log("PASS: Marked GFM nested lists, task lists and tables");
console.log("PASS: raw HTML and unsafe link/image destinations are neutralized");
console.log("PASS: 8 generated pages independently checked");
console.log("PASS: author, draft label, source and attribution checks passed");
console.log("PASS: all 8 SVG assets exist and are referenced locally");
console.log("PASS: JSON-LD, noindex, no-store and crawler exclusion checks passed");
console.log("PASS: no executable script tags in generated pages");
