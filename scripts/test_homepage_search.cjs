#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

// Protect the accessible markup and the CSS behavior when cards are filtered.
assert.match(home, /<label for="article-search">/);
assert.match(home, /id="article-search"[^>]*aria-controls="article-grid"/);
assert.match(home, /id="article-search-status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.ok(home.includes('<div class="article-tools" hidden>'), 'search toolbar should start hidden until its handler is ready');
assert.ok(css.includes('.article-card[hidden]{display:none!important}'), 'filtered cards must be hidden');
assert.equal((home.match(/<article class="article-card\b/g) || []).length, 6, 'fixture expects six article cards');

const cards = [
  { textContent: 'AI CƠ BẢN 5 cách bắt đầu dùng AI trong công việc mà không cần biết lập trình Đúng cách', hidden: false },
  { textContent: 'TỰ ĐỘNG HÓA Thiết kế quy trình AI có bước kiểm duyệt của con người', hidden: false },
  { textContent: 'CÔNG CỤ Bản đồ công cụ miễn phí để xây dựng blog AI', hidden: false },
  { textContent: 'AI THỰC HÀNH Checklist kiểm chứng nội dung AI trước khi xuất bản', hidden: false },
  { textContent: 'WORKFLOW Xây dựng workflow AI có kiểm duyệt với Airtable và Activepieces', hidden: false },
  { textContent: 'SEO KỸ THUẬT Checklist SEO kỹ thuật cho blog mới', hidden: false },
];
const listeners = {};
const input = { value: '', addEventListener: (name, callback) => { listeners[name] = callback; } };
const status = { textContent: '' };
const tools = { hidden: true };
const year = { textContent: '' };
const document = {
  querySelector: (selector) => ({
    '#year': year,
    '#article-search': input,
    '#article-search-status': status,
    '.article-tools': tools,
  }[selector] || null),
  querySelectorAll: (selector) => selector === '#article-grid .article-card' ? cards : [],
};
const window = { matchMedia: () => ({ matches: true }) };
vm.runInNewContext(source, { document, window, Date, Array, String });

const visibleIndexes = () => cards.flatMap((card, index) => card.hidden ? [] : [index]);
const search = (query) => { input.value = query; listeners.input(); };
assert.equal(typeof listeners.input, 'function', 'input handler should be registered');
assert.equal(tools.hidden, false, 'toolbar should show once the handler is ready');
assert.deepEqual(visibleIndexes(), [0, 1, 2, 3, 4, 5], 'initial state should show every article');
assert.equal(status.textContent, 'Hiển thị tất cả 6 bài viết.');

search('kiem chung');
assert.deepEqual(visibleIndexes(), [3], 'Vietnamese query without diacritics should match');
search('dung cach');
assert.deepEqual(visibleIndexes(), [0], 'uppercase Đ should normalize correctly');
search('SEO');
assert.deepEqual(visibleIndexes(), [5], 'case-insensitive keyword search should work');
search('khong-co-bai');
assert.deepEqual(visibleIndexes(), [], 'non-matching query should hide all articles');
assert.match(status.textContent, /Không tìm thấy/);
search('');
assert.deepEqual(visibleIndexes(), [0, 1, 2, 3, 4, 5], 'clearing the query should restore all articles');
assert.equal(status.textContent, 'Hiển thị tất cả 6 bài viết.');
console.log('PASS: search markup, accessibility, accented/unaccented Vietnamese, uppercase Đ, no results, reset');
