#!/usr/bin/env node
'use strict';

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATH_CLASSES = Object.freeze({
  docs: [
    /^README(?:\..*)?$/i,
    /^docs\//,
    /^\.github\/(?:ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\//,
    /^(?:LICENSE|CONTRIBUTING)(?:\..*)?$/i,
  ],
  content: [
    /^articles\//,
    /^(?:index\.html|thu-vien\.html|ngan-hang-ai\.html|sitemap\.xml|feed\.xml|styles\.css)$/,
    /^data\/ai-tools\.json$/,
    /^(?:images|illustrations)\//,
  ],
  runtime: [
    /^agents\/runtime\//,
    /^agents\/agent-registry\.json$/,
    /^scripts\/agent-/,
    /^tests\/agent-/,
  ],
  application: [
    /^(?:worker\.mjs|wrangler(?:\.[^/]+)?\.jsonc?)$/,
    /^(?:src|functions|migrations|db)\//,
    /^tests\/(?!agent-)/,
    /^scripts\/(?!agent-)/,
    /^package(?:-lock)?\.json$/,
  ],
  workflow: [
    /^\.github\/workflows\//,
    /^\.github\/actions\//,
  ],
});

export function classifyChangedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return 'mixed-unknown';
  const classes = new Set();
  for (const rawPath of paths) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return 'mixed-unknown';
    const path = rawPath.replaceAll('\\', '/').replace(/^\.\//, '');
    const matches = Object.entries(PATH_CLASSES)
      .filter(([, patterns]) => patterns.some((pattern) => pattern.test(path)))
      .map(([name]) => name);
    if (matches.length !== 1) return 'mixed-unknown';
    classes.add(matches[0]);
  }
  if (classes.size !== 1) return 'mixed-unknown';
  return classes.values().next().value + '-only';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('Usage: node scripts/premerge-path-classifier.mjs <base-sha> <head-sha>');
    process.exit(2);
  }
  const output = execFileSync('git', ['diff', '--name-only', '-z', base + '...' + head], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const paths = output.split('\0').filter(Boolean);
  process.stdout.write(classifyChangedPaths(paths) + '\n');
}
