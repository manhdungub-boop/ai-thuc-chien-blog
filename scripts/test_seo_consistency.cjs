#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const baseUrl = 'https://ai-thuc-chien-blog.manhdungub.workers.dev';
const workerDeployWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-cloudflare-workers.yml'), 'utf8');
assert.match(workerDeployWorkflow, /^\s+- "thu-vien\.html"\s*$/m, 'Worker deploy path filter must include the topic library page');
const articleDir = path.join(root, 'articles');
const articleFiles = fs.readdirSync(articleDir).filter((name) => name.endsWith('.html')).sort();
assert.ok(articleFiles.length > 0, 'No article HTML files found');

// Build the exact deployment artifact before validating generated SEO files.
require('./build_static_site.cjs');

const distDir = path.join(root, 'dist');
const sitemap = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8');
const feed = fs.readFileSync(path.join(distDir, 'feed.xml'), 'utf8');
assert.match(sitemap, /<urlset\b[\s\S]*<\/urlset>/, 'dist/sitemap.xml is not a URL set');
assert.match(feed, /<rss\b[\s\S]*<\/rss>/, 'dist/feed.xml is not an RSS document');

const sitemapUrls = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((m) => m[1].trim());
const sitemapEntries = [...sitemap.matchAll(/<url>\s*([\s\S]*?)<\/url>/g)].map((match) => {
  const block = match[1];
  const loc = block.match(/<loc>\s*([^<]+)\s*<\/loc>/);
  assert.ok(loc, 'Sitemap URL entry is missing its location');
  const lastmod = block.match(/<lastmod>\s*([^<]+)\s*<\/lastmod>/);
  return { url: loc[1].trim(), lastmod: lastmod ? lastmod[1].trim() : '' };
});
assert.equal(sitemapEntries.length, sitemapUrls.length, 'Sitemap must have one valid entry per URL location');
const feedUrls = [...feed.matchAll(/<link>\s*(https?:\/\/[^<]+)\s*<\/link>/g)].map((m) => m[1].trim());
assert.ok(sitemapUrls.includes(baseUrl + '/'), 'Sitemap must include the homepage');
assert.ok(sitemapUrls.includes(baseUrl + '/ve-chung-toi.html'), 'Sitemap must include the about/editorial policy page');
assert.ok(sitemapUrls.includes(baseUrl + '/ngan-hang-ai.html'), 'Sitemap must include the AI bank page');
assert.equal(new Set(sitemapUrls).size, sitemapUrls.length, 'Sitemap contains duplicate URLs');

const publicPages = [
  { file: 'index.html', expected: baseUrl + '/' },
  { file: 've-chung-toi.html', expected: baseUrl + '/ve-chung-toi.html' },
  { file: 'thu-vien.html', expected: baseUrl + '/thu-vien.html' },
  { file: 'ngan-hang-ai.html', expected: baseUrl + '/ngan-hang-ai.html' },
  ...articleFiles.map((file) => ({ file: path.join('articles', file), expected: null }))
];

const canonicalUrls = [];
for (const page of publicPages) {
  const fullPath = path.join(root, page.file);
  const source = fs.readFileSync(fullPath, 'utf8');
  const label = page.file;
  assert.match(source, /<html\b[^>]*lang=["']vi["']/i, label + ': missing Vietnamese document language');
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  assert.ok(title && title[1].trim(), label + ': missing title');
  assert.match(source, /<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']{30,}["']/i, label + ': missing or too-short meta description');
  const openGraphTitleTag = (source.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i) || [])[0] || '';
  const openGraphTitle = openGraphTitleTag.match(/\bcontent=["']([^"']+)["']/i);
  assert.ok(openGraphTitle && openGraphTitle[1].trim(), label + ': missing Open Graph title');
  const openGraphDescriptionTag = (source.match(/<meta\b[^>]*property=["']og:description["'][^>]*>/i) || [])[0] || '';
  const openGraphDescription = openGraphDescriptionTag.match(/\bcontent=["']([^"']+)["']/i);
  assert.ok(openGraphDescription && openGraphDescription[1].trim().length >= 30, label + ': missing or too-short Open Graph description');
  if (page.file === 'thu-vien.html') {
    assert.match(source, /69 bài thực hành/i, 'Topic library should show its verified 48-article inventory');
    assert.doesNotMatch(source, /40 hướng dẫn|40 bài thực hành/i, 'Topic library must not retain stale 40-article copy');
  }
  const canonicalTag = (source.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [])[0] || '';
  const canonicalMatch = canonicalTag.match(/\bhref=["']([^"']+)["']/i);
  assert.ok(canonicalMatch, label + ': missing canonical URL');
  const canonical = canonicalMatch[1];
  if (page.expected) assert.equal(canonical, page.expected, label + ': unexpected canonical URL');
  else {
    assert.ok(canonical.startsWith(baseUrl + '/articles/'), label + ': article canonical uses unexpected host/path');
    assert.ok(!canonical.endsWith('.html'), label + ': article canonical should remain extensionless');
  }
  assert.ok(!canonical.includes('?'), label + ': canonical URL must not contain tracking/query parameters');
  canonicalUrls.push(canonical);
  assert.ok(sitemapUrls.includes(canonical), label + ': canonical URL missing from generated sitemap');
  const sitemapEntry = sitemapEntries.find((entry) => entry.url === canonical);
  assert.ok(sitemapEntry, label + ': canonical URL missing a sitemap entry');
  const modifiedDates = [...source.matchAll(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})(?:T[^"]*)?"/gi)]
    .map((match) => match[1])
    .sort();
  const expectedLastmod = modifiedDates[modifiedDates.length - 1] || '';
  assert.equal(sitemapEntry.lastmod, expectedLastmod, label + ': sitemap lastmod must match explicit dateModified metadata and be omitted when unknown');

  const jsonLdBlocks = [...source.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(jsonLdBlocks.length > 0, label + ': missing JSON-LD structured data');
  for (const block of jsonLdBlocks) {
    assert.doesNotThrow(() => JSON.parse(block[1].trim()), label + ': invalid JSON-LD structured data');
  }
  assert.ok(fs.existsSync(path.join(distDir, page.file)), label + ': page missing from deployment output');
}

// Resource-loading regression guard for mobile performance.
const outputHtmlFiles = [
  ...publicPages.map((page) => path.join(distDir, page.file)),
  ...articleFiles.map((file) => path.join(distDir, 'articles', file))
];
for (const filePath of outputHtmlFiles) {
  const html = fs.readFileSync(filePath, 'utf8');
  const label = path.relative(distDir, filePath);
  if (/fonts\.googleapis\.com\/css2\?/.test(html)) {
    assert.match(html, /rel=[\"']preload[\"'][^>]*as=[\"']style[\"'][^>]*href=[\"']https:\/\/fonts\.googleapis\.com\/css2\?/i, label + ': Google Fonts should be preloaded asynchronously');
    assert.match(html, /onload=[\"']this\.onload=null;this\.rel=\\?['\"]stylesheet/i, label + ': Google Fonts preload must activate its stylesheet');
  }
  if (/<script\b[^>]*src=[\"'][^\"']*script\.js[\"']/i.test(html)) {
    assert.match(html, /<script\b[^>]*src=[\"'][^\"']*script\.js[\"'][^>]*\bdefer\b/i, label + ': site JavaScript must be deferred');
  }
}

assert.equal(new Set(canonicalUrls).size, canonicalUrls.length, 'Public HTML pages contain duplicate canonical URLs');

for (const file of articleFiles) {
  const source = fs.readFileSync(path.join(articleDir, file), 'utf8');
  const canonical = source.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)[0].match(/\bhref=["']([^"']+)["']/i)[1];
  assert.ok(feedUrls.includes(canonical), file + ': canonical URL missing from generated RSS feed');
}

const sitemapArticleUrls = sitemapUrls.filter((url) => url.startsWith(baseUrl + '/articles/'));
const feedArticleUrls = feedUrls.filter((url) => url.startsWith(baseUrl + '/articles/'));
assert.equal(sitemapArticleUrls.length, articleFiles.length, 'Generated sitemap article count differs from source article count');
assert.equal(feedArticleUrls.length, articleFiles.length, 'Generated RSS article count differs from source article count');
assert.equal(sitemapUrls.length, articleFiles.length + 4, 'Sitemap should contain homepage, about page, topic library, AI bank, and every article');

console.log('SEO CONSISTENCY PASS: ' + articleFiles.length + ' articles and 3 static pages have valid metadata, JSON-LD, canonical URLs, sitemap/RSS parity, and deployment output.');
