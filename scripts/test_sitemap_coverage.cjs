'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSitemapCoverage } = require('./lib/sitemap-coverage.cjs');

const base = 'https://example.test';
const xml = (paths) => `<urlset>${paths.map((p) => `<url><loc>${p.startsWith('http') ? p : base + p}</loc></url>`).join('')}</urlset>`;

test('passes when sitemap and source article paths match', () => {
  const result = analyzeSitemapCoverage(xml(['/articles/a', '/articles/b', '/thu-vien.html']), ['/articles/a.html', '/articles/b.html'], base);
  assert.deepEqual(result.unexpectedArticlePaths, []);
  assert.deepEqual(result.missingArticlePaths, []);
  assert.deepEqual(result.duplicateArticlePaths, []);
});

test('reports unexpected sitemap article paths', () => {
  const result = analyzeSitemapCoverage(xml(['/articles/a', '/articles/old']), ['/articles/a.html'], base);
  assert.deepEqual(result.unexpectedArticlePaths, ['/articles/old']);
});

test('reports missing source article paths', () => {
  const result = analyzeSitemapCoverage(xml(['/articles/a']), ['/articles/a.html', '/articles/b.html'], base);
  assert.deepEqual(result.missingArticlePaths, ['/articles/b']);
});

test('reports duplicate article paths even with query variants', () => {
  const result = analyzeSitemapCoverage(xml(['/articles/a', 'https://example.test/articles/a?ref=old']), ['/articles/a.html'], base);
  assert.deepEqual(result.duplicateArticlePaths, ['/articles/a']);
});

test('ignores non-article URLs and malformed locations', () => {
  const result = analyzeSitemapCoverage('<urlset><url><loc>https://example.test/thu-vien.html</loc></url><url><loc>http://[</loc></url></urlset>', [], base);
  assert.deepEqual(result.articleUrls, []);
  assert.deepEqual(result.unexpectedArticlePaths, []);
  assert.deepEqual(result.missingArticlePaths, []);
});
