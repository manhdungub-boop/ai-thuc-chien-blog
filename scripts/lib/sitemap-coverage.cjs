'use strict';

function analyzeSitemapCoverage(sitemapXml, expectedArticlePaths, baseUrl) {
  const locs = [...String(sitemapXml).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
  const articleUrls = locs.filter((value) => {
    try { return new URL(value, baseUrl).pathname.startsWith('/articles/'); }
    catch { return false; }
  });
  const canonicalPath = (value) => {
    try {
      const url = new URL(value, baseUrl);
      return url.pathname.replace(/\/$/, '');
    } catch { return null; }
  };
  const expected = expectedArticlePaths.map(canonicalPath).filter(Boolean);
  const actual = articleUrls.map(canonicalPath).filter(Boolean);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const duplicates = [...new Set(actual.filter((p, i) => actual.indexOf(p) !== i))].sort();
  return {
    totalUrls: locs.length,
    articleUrls: actual,
    duplicateArticlePaths: duplicates,
    unexpectedArticlePaths: [...actualSet].filter((p) => !expectedSet.has(p)).sort(),
    missingArticlePaths: [...expectedSet].filter((p) => !actualSet.has(p)).sort(),
    duplicateAllUrls: locs.length !== new Set(locs).size,
  };
}

module.exports = { analyzeSitemapCoverage };
