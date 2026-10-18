#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const baseUrl = 'https://ai-thuc-chien-blog.manhdungub.workers.dev';
const articleDir = path.join(root, 'articles');
const articleFiles = fs.readdirSync(articleDir).filter((name) => name.endsWith('.html')).sort();
assert.ok(articleFiles.length > 0, 'No article HTML files found');

const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const feed = fs.readFileSync(path.join(root, 'feed.xml'), 'utf8');

assert.match(sitemap, /<urlset\b[\s\S]*<\/urlset>/, 'sitemap.xml is not a URL set');
assert.match(feed, /<rss\b[\s\S]*<\/rss>/, 'feed.xml is not an RSS document');

const sitemapUrls = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((m) => m[1].trim());
const feedUrls = [...feed.matchAll(/<link>\s*(https?:\/\/[^<]+)\s*<\/link>/g)].map((m) => m[1].trim());
assert.ok(sitemapUrls.includes(baseUrl + '/'), 'Sitemap must include the homepage');
assert.ok(new Set(sitemapUrls).size === sitemapUrls.length, 'Sitemap contains duplicate URLs');

for (const file of articleFiles) {
  const source = fs.readFileSync(path.join(articleDir, file), 'utf8');
  const canonicalMatch = source.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  assert.ok(canonicalMatch, file + ': missing canonical URL');
  const canonical = canonicalMatch[1];
  assert.ok(canonical.startsWith(baseUrl + '/articles/'), file + ': canonical URL uses unexpected host/path');
  assert.ok(!canonical.endsWith('.html'), file + ': canonical policy should remain extensionless');
  assert.ok(sitemapUrls.includes(canonical), file + ': canonical URL is missing from sitemap.xml');
  assert.ok(feedUrls.includes(canonical), file + ': canonical URL is missing from feed.xml');
  assert.ok(fs.existsSync(path.join(root, 'articles', file)), file + ': source file disappeared');
}

const sitemapArticleUrls = sitemapUrls.filter((url) => url.startsWith(baseUrl + '/articles/'));
const feedArticleUrls = feedUrls.filter((url) => url.startsWith(baseUrl + '/articles/'));
assert.equal(sitemapArticleUrls.length, articleFiles.length, 'Sitemap article count differs from article HTML count');
assert.equal(feedArticleUrls.length, articleFiles.length, 'RSS article count differs from article HTML count');

console.log('SEO CONSISTENCY PASS: ' + articleFiles.length + ' articles match canonical URLs, sitemap.xml, and feed.xml.');
