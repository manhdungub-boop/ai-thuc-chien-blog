#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const siteUrl = (process.env.SITE_URL || 'https://ai-thuc-chien-blog.manhdungub.workers.dev').replace(/\/$/, '');
const articleDir = path.resolve(__dirname, '..', 'articles');
const articleFiles = fs.readdirSync(articleDir).filter((name) => name.endsWith('.html'));
assert.ok(articleFiles.length > 0, 'No source article files found; cannot validate deployed coverage');

async function get(pathname) {
  const url = `${siteUrl}${pathname}${pathname.includes('?') ? '&' : '?'}healthcheck=${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'cache-control': 'no-cache', pragma: 'no-cache' }, signal: AbortSignal.timeout(20000) });
      const body = await response.text();
      if (response.status === 200) return { body, response };
      lastError = new Error(`${pathname} returned HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw new Error(`${siteUrl}${pathname}: ${lastError?.message || lastError}`);
}

(async () => {
  const requiredPaths = ['/', '/thu-vien.html', '/ve-chung-toi.html', '/sitemap.xml', '/feed.xml', '/articles/do-luong-hieu-qua-blog'];
  const pages = new Map();
  for (const pathname of requiredPaths) {
    const result = await get(pathname);
    pages.set(pathname, result.body);
    console.log(`PASS ${pathname}: HTTP ${result.response.status}`);
  }

  const homepage = pages.get('/');
  assert.match(homepage, /<html\b[^>]*lang=["']vi["']/i, 'Homepage must declare Vietnamese language');
  assert.match(homepage, /<title[^>]*>\s*[^<]+\s*<\/title>/i, 'Homepage must include a non-empty title');

  const library = pages.get('/thu-vien.html');
  assert.match(library, /Thư viện/i, 'Library route did not return library content');
  const declaredLibraryCount = Number((library.match(/THƯ VIỆN THỰC HÀNH[^<]*?(\d+)\s*BÀI/i) || [])[1]);
  assert.ok(Number.isInteger(declaredLibraryCount) && declaredLibraryCount > 0, 'Library must declare its article count');
  const libraryLinks = [...library.matchAll(/href=["'](?:\.\/)?articles\/[^"']+\.html["']/gi)];
  assert.equal(libraryLinks.length, declaredLibraryCount, `Library article link count mismatch: declared ${declaredLibraryCount}, got ${libraryLinks.length}`);

  const sitemap = pages.get('/sitemap.xml');
  assert.match(sitemap, /<urlset\b[\s\S]*<\/urlset>/i, 'Live sitemap is not a valid URL set');
  const sitemapUrls = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) => match[1].trim());
  const articleUrls = sitemapUrls.filter((url) => { try { return new URL(url).pathname.startsWith('/articles/'); } catch { return false; } });
  assert.equal(articleUrls.length, articleFiles.length, `Live sitemap article count mismatch: expected ${articleFiles.length}, got ${articleUrls.length}`);
  assert.ok(sitemapUrls.some((url) => { try { return new URL(url).pathname === '/thu-vien.html'; } catch { return false; } }), 'Live sitemap is missing the library page');
  assert.equal(new Set(sitemapUrls).size, sitemapUrls.length, 'Live sitemap contains duplicate URLs');

  const feed = pages.get('/feed.xml');
  assert.match(feed, /<rss\b[\s\S]*<\/rss>/i, 'Live RSS feed is not a valid RSS document');
  console.log(`DEPLOYED ROUTE PASS: ${siteUrl}; ${articleFiles.length} source articles, ${libraryLinks.length} library links, ${articleUrls.length} sitemap article URLs, ${sitemapUrls.length} total sitemap URLs.`);
})().catch((error) => { console.error(`DEPLOYED ROUTE FAIL: ${error.message}`); process.exitCode = 1; });
