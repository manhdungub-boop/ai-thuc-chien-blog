#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const allowlistStart = source.indexOf('const communityAuthHosts = new Set([');
assert.notEqual(allowlistStart, -1, 'Community auth host allowlist must remain explicit');
const allowlistEnd = source.indexOf(']);', allowlistStart);
assert.notEqual(allowlistEnd, -1, 'Community auth host allowlist must close');
const allowlist = source.slice(allowlistStart, allowlistEnd);
assert.ok(allowlist.includes("'security-release-readiness-ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev'"),
  'Current release-readiness Preview hostname must be allowed to display the login form');
assert.ok(allowlist.includes("'preview-google-oauth-secret-ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev'"),
  'Dedicated Google OAuth refresh Preview hostname must be allowed to display the login form');
assert.ok(source.includes('if (!communityAuthHosts.has(window.location.hostname))'),
  'Unknown hostnames must continue to fail closed');
assert.ok(source.includes('authPanel.hidden = true;'),
  'The auth panel must remain hidden on unapproved hosts');
console.log('PASS: release-readiness Preview login form host is allowlisted; unknown hosts remain blocked');
