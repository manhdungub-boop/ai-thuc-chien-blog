import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

const root = process.cwd();
const sourceRoot = path.join(root, "docs", "content-drafts");
const outputRoot = path.join(root, "draft-preview-output");
const expectedDrafts = [
  "kien-thuc-ai/bo-kiem-thu-20-cau-hoi-danh-gia-chat-luong-ai.md",
  "kien-thuc-ai/rag-kho-tri-thuc-co-trich-dan.md",
  "ai-tu-dong-hoa/agent-quyen-han-toi-thieu-human-approval.md",
  "ai-tu-dong-hoa/workflow-chong-loi-idempotency-dead-letter.md",
  "ai-kiem-tien/dong-goi-dich-vu-ai-cho-doanh-nghiep-nho.md",
  "ai-kiem-tien/phan-tich-hoa-von-va-tco-du-an-ai.md",
  "cong-cu-ai-mien-phi/chay-ai-local-ollama-open-webui.md",
  "cong-cu-ai-mien-phi/chuyen-giong-noi-local-whisper-cpp.md",
];

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
const { renderDraftMarkdown: renderMarkdown } = await import("./draft-markdown-renderer.mjs");
function metadataAndBody(source, file) {
  const m = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  assert.ok(m, file + ": front matter missing");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const pair = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
    if (pair) meta[pair[1]] = pair[2].replace(/^["']|["']$/g, "");
  }
  ["title","slug","category","author","status","seo_description"].forEach(function (key) {
    assert.ok(meta[key], file + ": " + key + " missing");
  });
  assert.equal(meta.author, "DUNG - AI", file + ": wrong author");
  assert.equal(meta.status, "draft", file + ": non-draft content rejected");
  assert.match(meta.slug, /^[a-z0-9-]+$/, file + ": invalid slug");
  return {meta:meta, body:m[2]};
}
function page(meta, bodyHtml) {
  const ld = JSON.stringify({
    "@context":"https://schema.org","@type":"Article",
    headline:meta.title,description:meta.seo_description,
    author:{"@type":"Person",name:"DUNG - AI"},articleSection:meta.category
  }).replace(/</g, "\\u003c");
  return '<!doctype html>\n<html lang="vi"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow,noarchive">' +
    '<meta name="description" content="' + esc(meta.seo_description) + '">' +
    '<meta name="author" content="DUNG - AI"><meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src \'self\' data:; style-src \'unsafe-inline\'; script-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>' + esc(meta.title) + ' | Bản xem trước DUNG - AI</title>' +
    '<script type="application/ld+json">' + ld + '</script>' +
    '<style>body{margin:0;background:#f5f7fa;color:#17202a;font:16px/1.75 system-ui,sans-serif}header,.notice,main,footer{width:min(900px,calc(100% - 32px));margin:20px auto}main{background:white;padding:clamp(20px,5vw,48px);border-radius:12px}h1,h2,h3{line-height:1.3}img{display:block;max-width:100%;height:auto;margin:20px auto}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d7dde5;padding:8px;text-align:left;vertical-align:top}pre{overflow:auto;background:#111827;color:#fff;padding:16px;border-radius:8px}blockquote{border-left:4px solid #9aa8b8;padding-left:16px}.notice{padding:14px 18px;border:1px solid #d7a84b;background:#fff8e8;border-radius:8px}</style>' +
    '</head><body><header><a href="../../">← Danh sách bản xem trước</a></header>' +
    '<div class="notice"><strong>BẢN NHÁP – CHƯA XUẤT BẢN</strong><br>Chỉ dùng để rà soát. Không nhập thông tin tài khoản hoặc dữ liệu cá nhân.</div>' +
    '<main><p><strong>' + esc(meta.category) + '</strong> · Tác giả: <strong>DUNG - AI</strong> · ' + esc(meta.reading_time || "") + '</p>' +
    bodyHtml + '</main><footer>© DUNG - AI. Cần rà soát và phê duyệt trước khi phát hành.</footer></body></html>';
}

await rm(outputRoot, {recursive:true,force:true});
await mkdir(path.join(outputRoot,"drafts"),{recursive:true});
await mkdir(path.join(outputRoot,"assets"),{recursive:true});
const assets = path.join(sourceRoot,"assets");
assert.ok((await stat(assets)).isDirectory(),"draft SVG assets directory missing");
await cp(assets,path.join(outputRoot,"assets"),{recursive:true});
const seen = new Set(), items = [];
for (const rel of expectedDrafts) {
  const src = await readFile(path.join(sourceRoot,rel),"utf8");
  const parsed = metadataAndBody(src,rel), meta = parsed.meta, body = parsed.body;
  assert.ok(!seen.has(meta.slug),"duplicate slug: "+meta.slug); seen.add(meta.slug);
  const refs = [...body.matchAll(/!\[[^\]]*\]\(\.\.\/assets\/([a-z0-9-]+\.svg)\)/gi)].map(function (m) { return m[1]; });
  assert.ok(refs.length > 0,rel+": diagram missing");
  for (const file of refs) await stat(path.join(outputRoot,"assets",file));
  assert.match(body,/##\s+Nguồn (tham khảo|chính thức)/i,rel+": source section missing");
  assert.match(body,/ghi rõ tác giả:\s*DUNG - AI/i,rel+": attribution missing");
  const dest = path.join(outputRoot,"drafts",meta.slug,"index.html");
  await mkdir(path.dirname(dest),{recursive:true});
  await writeFile(dest,page(meta,renderMarkdown(body)));
  items.push({title:meta.title,category:meta.category,slug:meta.slug});
}
assert.equal(items.length,8);
const index = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>8 bản nháp | DUNG - AI</title></head><body><h1>8 bài viết – Bản xem trước nội bộ</h1><p><strong>Chưa xuất bản.</strong> Cần rà soát và phê duyệt riêng trước khi phát hành.</p><ol>' +
  items.map(function (x) { return '<li><strong>'+esc(x.category)+'</strong> — <a href="drafts/'+x.slug+'/">'+esc(x.title)+'</a></li>'; }).join("") +
  '</ol><p>Tác giả: DUNG - AI</p></body></html>';
await writeFile(path.join(outputRoot,"index.html"),index);
await writeFile(path.join(outputRoot,"robots.txt"),"User-agent: *\nDisallow: /\n");
await writeFile(path.join(outputRoot,"_headers"),"/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n");
await writeFile(path.join(outputRoot,"404.html"),'<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><title>Không tìm thấy</title></head><body><h1>Không tìm thấy trang</h1><a href="/">Quay lại</a></body></html>');
console.log("PASS: generated exactly 8 draft-only HTML pages");
console.log("PASS: author, status, sources, attribution and local SVG references checked");
console.log("PASS: noindex, no-store and crawler disallow files generated");
console.log("PASS: output isolated in draft-preview-output; site-snapshot is untouched");
