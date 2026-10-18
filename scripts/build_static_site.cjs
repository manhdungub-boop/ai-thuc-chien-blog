'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const rootFiles = ['index.html', 've-chung-toi.html', 'feed.xml', 'styles.css', 'script.js', 'robots.txt', 'sitemap.xml', 'favicon.svg', '404.html', 'google4e45ddcf8facb122.html', '_headers'];
function fail(message) { console.error('STATIC BUILD FAIL:', message); process.exit(1); }
for (const name of rootFiles) if (!fs.existsSync(path.join(root, name))) fail('Required source file is missing: ' + name);
const articlesDir = path.join(root, 'articles');
if (!fs.existsSync(articlesDir) || !fs.statSync(articlesDir).isDirectory()) fail('articles/ source directory is missing');
const articles = fs.readdirSync(articlesDir).filter((name) => name.endsWith('.html')).sort();
if (articles.length === 0) fail('No article HTML files found');
const headerRules = fs.readFileSync(path.join(root, '_headers'), 'utf8');
const requiredHeaders = ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy: strict-origin-when-cross-origin', 'Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=()', 'Strict-Transport-Security: max-age=31536000'];
for (const rule of requiredHeaders) if (!headerRules.includes(rule)) fail('_headers is missing rule: ' + rule);
fs.rmSync(output, { recursive: true, force: true });
const outputArticles = path.join(output, 'articles');
fs.mkdirSync(outputArticles, { recursive: true });
for (const name of rootFiles) fs.copyFileSync(path.join(root, name), path.join(output, name));
for (const name of articles) fs.copyFileSync(path.join(articlesDir, name), path.join(outputArticles, name));
if (!fs.existsSync(path.join(output, '_headers'))) fail('_headers was not included in dist/');
if (!fs.existsSync(path.join(output, 'google4e45ddcf8facb122.html'))) fail('Search Console verification file was not included in dist/');
if (fs.readdirSync(outputArticles).filter((name) => name.endsWith('.html')).length !== articles.length) fail('The staged article count differs from the source article count');
require('./generate_seo_feeds.cjs')(output);
console.log('STATIC BUILD PASS: ' + rootFiles.length + ' root assets, ' + articles.length + ' articles, and generated SEO feeds packaged in dist/');
