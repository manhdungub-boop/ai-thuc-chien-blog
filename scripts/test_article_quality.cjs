#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const articleDir = path.join(root, 'articles');
const files = fs.readdirSync(articleDir).filter((name) => name.endsWith('.html')).sort();
assert.ok(files.length > 0, 'expected at least one article');

function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

for (const file of files) {
  const source = fs.readFileSync(path.join(articleDir, file), 'utf8');
  const fail = (message) => assert.fail(file + ': ' + message);

  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!title || !visibleText(title[1])) fail('missing or empty title');

  const description = source.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (!description || !description[1].trim()) fail('missing meta description');

  const h1s = source.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || [];
  if (h1s.length !== 1) fail('expected exactly one H1, found ' + h1s.length);

  const canonical = source.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  if (!canonical || !/^https:\/\//i.test(canonical[1])) fail('missing absolute HTTPS canonical URL');

  const blocks = [...source.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (blocks.length === 0) fail('missing JSON-LD structured data');
  for (const block of blocks) {
    try { JSON.parse(block[1]); } catch (error) { fail('invalid JSON-LD: ' + error.message); }
  }

  const words = visibleText(source).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || [];
  if (words.length < 250) fail('article body looks too short (' + words.length + ' words; minimum 250)');

  const related = source.match(/<nav\s+class=["']related-articles-grid["'][\s\S]*?<\/nav>/i);
  if (!related) fail('missing semantic related-articles navigation');

  // Related links must point directly to each article's extensionless canonical URL.
  // The physical source file remains articles/<slug>.html and is served by the Worker route mapper.
  const links = [...related[0].matchAll(/href=["\']\/articles\/([a-z0-9-]+)["\']/gi)]
    .map((match) => match[1]);
  if (links.length < 3) fail('expected at least 3 canonical related article links, found ' + links.length);
  if (new Set(links).size !== links.length) fail('duplicate related article links');
  if ((related[0].match(/href=/gi) || []).length !== links.length) fail('related navigation must use extensionless canonical article URLs');

  for (const slug of links) {
    const resolved = path.resolve(articleDir, slug + '.html');
    if (!resolved.startsWith(articleDir + path.sep)) fail('related link escapes article directory: /articles/' + slug);
    if (!fs.existsSync(resolved)) fail('broken related article link: /articles/' + slug);
    if (resolved === path.resolve(articleDir, file)) fail('related navigation links to itself');
  }

  console.log('ARTICLE QUALITY PASS: ' + file + ' (' + words.length + ' words, ' + links.length + ' related links)');
}
require('./test_article_distinctiveness.cjs');
console.log('CONTENT QUALITY GATE PASS: ' + files.length + ' articles checked');
