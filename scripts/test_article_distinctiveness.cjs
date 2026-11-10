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
  'activepieces-trigger-va-action',
  'ket-noi-api-webhook-an-toan',
  'airtable-lam-kho-du-lieu-workflow',
  'chong-trung-va-idempotency-workflow',
  'human-in-the-loop-trong-workflow',
  'xu-ly-loi-retry-workflow',
  'kiem-tra-chat-luong-bai-truoc-dang',
  'lap-dan-y-bai-viet-chuyen-sau',
  'seo-noi-dung-huu-ich',
  'tao-anh-ai-co-brief',
  'kiem-tra-ban-quyen-noi-dung-ai',
  'lich-bien-tap-va-xuat-ban',
  'affiliate-minh-bach-va-huu-ich',
  'bao-ve-api-key-automation',
  'bao-ve-du-lieu-khi-dung-ai',
  'do-luong-hieu-qua-noi-dung',
  'ke-hoach-30-ngay-kiem-chung-mo-hinh',
  'kiem-chung-cau-tra-loi-ai',
  'kiem-chung-san-pham-truoc-khi-gioi-thieu',
  'kiem-thu-dau-ra-ai',
  'kiem-thu-workflow-truoc-khi-bat',
  'lap-prompt-ai-co-cau-truc',
  'log-va-giam-sat-workflow',
  'nghien-cuu-chu-de-noi-dung',
  'viet-noi-dung-san-pham-co-bang-chung',
  'xay-dung-quy-trinh-lead-voi-human-approval',
  'tim-nhu-cau-thi-truong-cong-khai',
  'thu-nghiem-thi-truong-voi-ngan-sach-thap',
  'quan-ly-rui-ro-du-an-kiem-tien-ai',
  'tinh-loi-nhuan-thuc-tu-affiliate',
  'tinh-roi-tu-dong-hoa-ai',
  'tai-su-dung-noi-dung-da-kiem-chung',
  'xay-dung-thu-vien-prompt',
  'nghien-cuu-web-co-nguon-voi-ai',
  'phan-tich-du-lieu-bang-ai',
  'so-sanh-goi-mien-phi-ai',
  'ban-do-cong-cu-blog-ai',
  'bat-dau-voi-ai',
  'bien-y-tuong-thanh-noi-dung-da-kenh',
  'do-luong-hieu-qua-blog',
  'do-luong-hieu-qua-workflow-ai',
  'kiem-chung-noi-dung-ai',
  'kiem-tra-json-dau-ra-ai-truoc-khi-tu-dong-hoa',
  'seo-ky-thuat-blog-moi',
  'workflow-ai-airtable-activepieces',
  'xay-dung-kho-tri-thuc-ai-co-nguon',
  'viet-prompt-ai-hieu-qua',
  'nhan-biet-prompt-injection-ai',
  'bao-ve-api-key-trong-workflow-ai',
  'chon-cong-cu-ai-theo-cong-viec',
  'chon-mo-hinh-kiem-tien-bang-ai',
  'danh-gia-rui-ro-du-lieu-khi-dung-ai',
  'kiem-chung-noi-dung-dung-ai',
  'kiem-thu-chat-luong-dau-ra-ai',
  'quy-trinh-ai-co-kiem-duyet',
  'quy-trinh-viet-bai-voi-ai',
  'thiet-ke-workflow-ai-dau-cuoi',
  'workflow-ai-chong-loi-va-chay-lai-an-toan',
  'xay-bang-theo-doi-loi-nhuan-affiliate',
];
function coreTokens(slug) {
  const source = fs.readFileSync(path.join(root, 'articles', `${slug}.html`), 'utf8');
  const h1End = source.indexOf('</h1>');
  const sourcesHeading = /<h2\b[^>]*>\s*(?:Nguồn(?:\s+tham\s+khảo(?:\s+chính\s+thức)?|\s+chính\s+thức(?:\s+(?:để\s+)?(?:tra\s+cứu|đọc\s+sâu\s+hơn|đọc\s+thêm))?|\s+để\s+tra\s+cứu)|Tài\s+liệu(?:\s+chính\s+thức)?\s+tham\s+khảo)\s*<\/h2\s*>/i.exec(source);
  const sourceStart = sourcesHeading ? sourcesHeading.index : -1;
  assert.ok(h1End >= 0, `${slug}: H1 not found`);
  assert.ok(sourceStart > h1End, `${slug}: article sources section not found after H1`);
  let core = source.slice(h1End + 5, sourceStart)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, ' ').replace(/&quot;/gi, '"')
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
    assert.ok(score < 0.30, `article cores are too similar (${score.toFixed(3)}): ${slugs[i]} <> ${slugs[j]}`);
  }
}
console.log(`ARTICLE DISTINCTIVENESS PASS: ${slugs.length} targeted articles; max 5-gram Jaccard ${max.toFixed(3)} (${maxPair || 'no pair'})`);
