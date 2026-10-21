#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const slugs = [
  'chon-mo-hinh-ai-cho-cong-viec',
  'xay-bo-danh-gia-chat-luong-ai',
  'kiem-soat-quyen-va-du-lieu-workflow',
  'thiet-ke-workflow-co-diem-khoi-phuc',
  'kiem-chung-anh-va-noi-dung-ai-truoc-khi-dang',
  'kiem-chung-y-tuong-kiem-tien-ai-bang-thu-nghiem-nho',
];
function coreTokens(slug) {
  const source = fs.readFileSync(path.join(root, 'articles', `${slug}.html`), 'utf8');
  const h1End = source.indexOf('</h1>');
  const sourceStart = source.indexOf('<section><h2>Nguồn tham khảo chính thức</h2>');
  assert.ok(h1End >= 0, `${slug}: H1 not found`);
  assert.ok(sourceStart > h1End, `${slug}: article sources section not found after H1`);
  let core = source.slice(h1End + 5, sourceStart)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .toLocaleLowerCase('vi-VN');
  return core.match(/[\p{L}\p{N}]+/gu) || [];
}
function shingles(tokens, size = 5) {
  const result = new Set();
  for (let i = 0; i <= tokens.length - size; i++) result.add(tokens.slice(i, i + size).join(' '));
  return result;
}
const corpora = new Map();
for (const slug of slugs) {
  const tokens = coreTokens(slug);
  assert.ok(tokens.length >= 450, `${slug}: substantive core unexpectedly short (${tokens.length} tokens)`);
  corpora.set(slug, shingles(tokens));
}
let max = 0; let maxPair = '';
for (let i = 0; i < slugs.length; i++) {
  for (let j = i + 1; j < slugs.length; j++) {
    const a = corpora.get(slugs[i]); const b = corpora.get(slugs[j]);
    let intersection = 0; for (const value of a) if (b.has(value)) intersection++;
    const union = a.size + b.size - intersection;
    const score = union ? intersection / union : 0;
    if (score > max) { max = score; maxPair = `${slugs[i]} <> ${slugs[j]}`; }
    assert.ok(score < 0.30, `priority article cores are too similar (${score.toFixed(3)}): ${slugs[i]} <> ${slugs[j]}`);
  }
}
console.log(`ARTICLE DISTINCTIVENESS PASS: ${slugs.length} priority articles; max 5-gram Jaccard ${max.toFixed(3)} (${maxPair || 'no pair'})`);
