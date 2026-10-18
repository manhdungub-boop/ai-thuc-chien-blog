'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const rootFiles = ['index.html', 'thu-vien.html', 've-chung-toi.html', 'feed.xml', 'styles.css', 'script.js', 'robots.txt', 'sitemap.xml', 'favicon.svg', '404.html', 'google4e45ddcf8facb122.html', '_headers'];
function fail(message) { console.error('STATIC BUILD FAIL:', message); process.exit(1); }
for (const name of rootFiles) if (!fs.existsSync(path.join(root, name))) fail('Required source file is missing: ' + name);
const articlesDir = path.join(root, 'articles');
if (!fs.existsSync(articlesDir) || !fs.statSync(articlesDir).isDirectory()) fail('articles/ source directory is missing');
const articles = fs.readdirSync(articlesDir).filter((name) => name.endsWith('.html')).sort();
if (articles.length === 0) fail('No article HTML files found');
const headerRules = fs.readFileSync(path.join(root, '_headers'), 'utf8');
const requiredHeaders = ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy: strict-origin-when-cross-origin', 'Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=()', 'Strict-Transport-Security: max-age=31536000'];
for (const rule of requiredHeaders) if (!headerRules.includes(rule)) fail('_headers is missing rule: ' + rule);

// Keep the tracked fallback feeds current before copying them into the deployment bundle.
// The same generator is run again against dist/ after assets are staged.
require('./generate_seo_feeds.cjs')(root);

fs.rmSync(output, { recursive: true, force: true });
const outputArticles = path.join(output, 'articles');
fs.mkdirSync(outputArticles, { recursive: true });
for (const name of rootFiles) fs.copyFileSync(path.join(root, name), path.join(output, name));
for (const name of articles) fs.copyFileSync(path.join(articlesDir, name), path.join(outputArticles, name));
if (!fs.existsSync(path.join(output, '_headers'))) fail('_headers was not included in dist/');
if (!fs.existsSync(path.join(output, 'google4e45ddcf8facb122.html'))) fail('Search Console verification file was not included in dist/');
if (fs.readdirSync(outputArticles).filter((name) => name.endsWith('.html')).length !== articles.length) fail('The staged article count differs from the source article count');
// Load non-critical web fonts asynchronously and defer the small site script.
// This keeps text readable via CSS fallbacks while reducing render-blocking work.
function optimizeHtmlResourceLoading(filePath) {
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel=[\"']stylesheet[\"']/i.test(tag) || !/href=[\"']https:\/\/fonts\.googleapis\.com\/css2\?/i.test(tag)) return tag;
    const hrefMatch = tag.match(/\bhref=[\"']([^\"']+)[\"']/i);
    if (!hrefMatch) return tag;
    const href = hrefMatch[1];
    const preconnect = html.includes('href="https://fonts.gstatic.com"') ? '' : '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
    return preconnect + '<link rel="preload" as="style" href="' + href + '" onload="this.onload=null;this.rel=\'stylesheet\'">' + '<noscript><link rel="stylesheet" href="' + href + '"></noscript>';
  });
  html = html.replace(/<script\b[^>]*\bsrc=[\"'][^\"']*script\.js[\"'][^>]*>/gi, (tag) =>
    /\bdefer\b/i.test(tag) ? tag : tag.replace(/\s*\?>$/, ' defer>')
  );
  fs.writeFileSync(filePath, html);
}
const htmlOutputFiles = [
  ...rootFiles.filter((name) => name.endsWith('.html')).map((name) => path.join(output, name)),
  ...articles.map((name) => path.join(outputArticles, name))
];
for (const filePath of htmlOutputFiles) optimizeHtmlResourceLoading(filePath);

require('./generate_seo_feeds.cjs')(output);
console.log('STATIC BUILD PASS: ' + rootFiles.length + ' root assets, ' + articles.length + ' articles, and generated SEO feeds packaged in dist/');
