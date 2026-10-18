#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const articleDir = path.join(root, 'articles');
const files = fs.readdirSync(articleDir).filter((name) => name.endsWith('.html'));
assert.equal(files.length, 7, 'expected the seven published article files');
for (const file of files) {
  const source = fs.readFileSync(path.join(articleDir, file), 'utf8');
  assert.match(source, /<section class="related-articles" aria-labelledby="related-articles-title">/, `${file}: related section missing`);
  assert.match(source, /<nav class="related-articles-grid" aria-label="Bài viết liên quan">/, `${file}: semantic related-links navigation missing`);
  const block = source.match(/<nav class="related-articles-grid"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(block, `${file}: related navigation block missing`);
  const hrefs = [...block.matchAll(/href="\.\.\/(articles\/[^\"]+\.html)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length >= 3, `${file}: expected at least three related links, found ${hrefs.length}`);
  assert.equal(new Set(hrefs).size, hrefs.length, `${file}: duplicate related links`);
  for (const href of hrefs) {
    const target = path.resolve(root, href);
    assert.ok(fs.existsSync(target), `${file}: broken related link ${href}`);
    assert.notEqual(path.resolve(target), path.resolve(path.join(articleDir, file)), `${file}: self-link found`);
  }
  assert.match(source, /<main[\s\S]*?<\/main>\s*<footer>/, `${file}: main/footer structure invalid`);
}
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
assert.match(css, /\.related-articles-grid\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(css, /@media\(max-width:700px\)\{\.related-articles-grid\{grid-template-columns:1fr\}/);
console.log(`PASS: ${files.length} articles each have at least three unique, existing related links and responsive styling`);
