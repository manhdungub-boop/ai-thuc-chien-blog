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

// Protect accessible markup and filtering CSS.
assert.match(home, /<label for="article-search">/);
assert.match(home, /id="article-search"[^>]*aria-controls="article-grid"/);
assert.match(home, /id="article-search-status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.ok(home.includes('<div class="article-tools" hidden>'), 'search toolbar should start hidden until its handler is ready');
assert.ok(css.includes('.article-card[hidden]{display:none!important}'), 'filtered cards must be hidden');

const cardMarkup = [...home.matchAll(/<article class="article-card(?: featured)?">[\s\S]*?<\/article>/g)].map((match) => match[0]);
assert.ok(cardMarkup.length > 0, 'homepage should include at least one article card');
const toTextContent = (markup) => markup
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(?:amp|nbsp|#39|quot);/gi, (entity) => ({ '&amp;': '&', '&nbsp;': ' ', '&#39;': "'", '&quot;': '"' })[entity.toLowerCase()] ?? entity)
  .replace(/\s+/g, ' ')
  .trim();
const cards = cardMarkup.map((markup) => ({ textContent: toTextContent(markup), hidden: false }));
const cardIndex = (snippet) => {
  const index = cards.findIndex((card) => card.textContent.toLowerCase().includes(snippet.toLowerCase()));
  assert.notEqual(index, -1, `homepage is missing expected article text: ${snippet}`);
  return index;
};
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
const allIndexes = () => cards.map((_, index) => index);
const search = (query) => { input.value = query; listeners.input(); };
assert.equal(typeof listeners.input, 'function', 'input handler should be registered');
assert.equal(tools.hidden, false, 'toolbar should show once the handler is ready');
assert.deepEqual(visibleIndexes(), allIndexes(), 'initial state should show every homepage article');
assert.equal(status.textContent, `Hiển thị tất cả ${cards.length} bài viết.`);

search('ra soat nguon');
assert.deepEqual(visibleIndexes(), [cardIndex('Rà soát nguồn')], 'Vietnamese query without diacritics should match');
search('ĐO LƯỜNG THỰC TẾ');
assert.deepEqual(visibleIndexes(), [cardIndex('ĐO LƯỜNG THỰC TẾ')], 'uppercase Đ and diacritics should normalize correctly');
search('SEO');
assert.deepEqual(visibleIndexes(), [cardIndex('Checklist SEO kỹ thuật cho blog mới')], 'case-insensitive keyword search should work');
search('khong-co-bai');
assert.deepEqual(visibleIndexes(), [], 'non-matching query should hide all articles');
assert.match(status.textContent, /Không tìm thấy/);
search('');
assert.deepEqual(visibleIndexes(), allIndexes(), 'clearing the query should restore all articles');
assert.equal(status.textContent, `Hiển thị tất cả ${cards.length} bài viết.`);
console.log(`PASS: search markup/accessibility and Vietnamese search across ${cards.length} real homepage cards`);
