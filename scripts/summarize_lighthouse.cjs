#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const reportDir = path.join(process.cwd(), '.lighthouseci');
if (!fs.existsSync(reportDir)) {
  console.error('Lighthouse report directory .lighthouseci was not found.');
  process.exit(1);
}

const reports = fs.readdirSync(reportDir)
  .filter((name) => /^lhr-.*\.json$/i.test(name))
  .map((name) => {
    try { return JSON.parse(fs.readFileSync(path.join(reportDir, name), 'utf8')); }
    catch (error) { console.warn(`Skipping invalid Lighthouse JSON ${name}: ${error.message}`); return null; }
  })
  .filter((report) => report && report.categories && report.audits && (report.finalUrl || report.requestedUrl));

if (!reports.length) {
  console.error('No valid Lighthouse result JSON files were found in .lighthouseci.');
  process.exit(1);
}

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const score = (report, category) => {
  const value = report.categories[category]?.score;
  return Number.isFinite(value) ? value * 100 : null;
};
const metric = (report, id) => {
  const value = report.audits[id]?.numericValue;
  return Number.isFinite(value) ? value : null;
};
const fmt = (value, digits = 0) => value === null ? '—' : value.toFixed(digits);
const grouped = new Map();
for (const report of reports) {
  const url = report.finalUrl || report.requestedUrl;
  if (!grouped.has(url)) grouped.set(url, []);
  grouped.get(url).push(report);
}

const lines = [
  '## Lighthouse mobile metrics',
  '',
  `Measured ${reports.length} successful Lighthouse report(s). Values below are medians across runs for each URL; scores are out of 100.`,
  '',
  '| Page | Performance | Accessibility | Best practices | SEO | LCP | FCP | TBT | CLS |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|'
];
for (const [url, group] of grouped) {
  const aggregate = (fn) => median(group.map(fn));
  const p = aggregate((r) => score(r, 'performance'));
  const a = aggregate((r) => score(r, 'accessibility'));
  const b = aggregate((r) => score(r, 'best-practices'));
  const s = aggregate((r) => score(r, 'seo'));
  const lcp = aggregate((r) => metric(r, 'largest-contentful-paint'));
  const fcp = aggregate((r) => metric(r, 'first-contentful-paint'));
  const tbt = aggregate((r) => metric(r, 'total-blocking-time'));
  const cls = aggregate((r) => metric(r, 'cumulative-layout-shift'));
  const label = url.replace(/^https?:\/\//, '').replace(/\|/g, '%7C');
  lines.push(`| [${label}](${url}) | ${fmt(p)} | ${fmt(a)} | ${fmt(b)} | ${fmt(s)} | ${lcp === null ? '—' : `${fmt(lcp / 1000, 2)} s`} | ${fcp === null ? '—' : `${fmt(fcp / 1000, 2)} s`} | ${fmt(tbt)} ms | ${fmt(cls, 3)} |`);
}
lines.push('', 'Interpretation: compare repeated runs and historical audits before declaring a change an improvement. Lighthouse lab results can vary with runner/network conditions; field Core Web Vitals are a separate measurement.', '');
console.log(lines.join('\n'));
