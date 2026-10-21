#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('script.js', 'utf8');
assert.match(source, /response\.status\s*>=\s*500/);
assert.match(source, /payload\.code/);
assert.match(source, /payload\.reference/);
assert.match(source, /mã lỗi:/);
assert.match(source, /mã tham chiếu:/);
assert.doesNotMatch(source, /payload\.stack/);
console.log('PASS: community form shows only safe diagnostic stage/reference for HTTP 5xx, not a stack trace.');
