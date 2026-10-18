#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const copied = [];
const targets = { good: { value: 'Mẫu prompt cần sao chép.' }, unavailable: { value: 'Không sao chép được.' } };
const statuses = { goodStatus: { textContent: '' }, unavailableStatus: { textContent: '' } };
const handlers = {};
const makeButton = (target, status) => ({
  disabled: false,
  getAttribute: (name) => ({ 'data-copy-target': target, 'data-copy-status': status }[name] || null),
  addEventListener: (name, callback) => { handlers[target] = callback; },
});
const buttons = [makeButton('good', 'goodStatus'), makeButton('unavailable', 'unavailableStatus')];
const document = {
  querySelector: () => null,
  querySelectorAll: (selector) => selector === '[data-copy-target]' ? buttons : [],
  getElementById: (id) => targets[id] || statuses[id] || null,
};
const navigator = { clipboard: { writeText: async (text) => {
  if (text.startsWith('Không sao chép')) throw new Error('Clipboard permission denied');
  copied.push(text);
} } };
const window = { matchMedia: () => ({ matches: true }) };
vm.runInNewContext(source, { document, navigator, window, Date, Array, String });
assert.equal(typeof handlers.good, 'function');
assert.equal(typeof handlers.unavailable, 'function');
(async () => {
  await handlers.good();
  assert.deepEqual(copied, ['Mẫu prompt cần sao chép.']);
  assert.match(statuses.goodStatus.textContent, /Đã sao chép/);
  await handlers.unavailable();
  assert.match(statuses.unavailableStatus.textContent, /Không thể sao chép tự động/);
  console.log('PASS: prompt copy controls report success and provide a manual fallback on clipboard failure');
})().catch((error) => { console.error(error); process.exitCode = 1; });
