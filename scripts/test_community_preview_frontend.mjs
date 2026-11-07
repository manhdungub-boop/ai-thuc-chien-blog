#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const configured = String(process.env.PREVIEW_URL || '');
if (!configured) throw new Error('PREVIEW_URL is required.');
const base = new URL(configured);
const expectedHost = 'feature-required-email-verification-ai-thuc-chien-blog.manhdungub.workers.dev';
const isFeatureAlias = base.hostname === expectedHost;
const isGeneratedFeaturePreview = /^[a-f0-9]{8}-ai-thuc-chien-blog\.manhdungub\.workers\.dev$/i.test(base.hostname);
if (base.protocol !== 'https:' || !(isFeatureAlias || isGeneratedFeaturePreview) || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Safety stop: this test only targets the named feature Preview alias or a generated 8-hex deployment URL for this Worker.');
}
const target = base.origin;
async function get(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html,application/javascript,*/*' } });
    } catch (error) {
      lastError = error;
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw new Error(label + ' could not reach Preview (' + String(lastError?.name || 'network error') + ').');
}
const fakeToken = randomBytes(32).toString('base64url');
const page = await get(target + '/?verify=' + fakeToken + '#cong-dong', 'Preview homepage');
assert.equal(page.status, 200, 'Preview homepage must return HTTP 200, got ' + page.status);
assert.match(page.headers.get('content-type') || '', /text\/html/i, 'Preview homepage must serve HTML');
const html = await page.text();
assert.match(html, /community-verify-confirm/, 'Preview homepage must include the email verification control');
assert.match(html, /script\.js/, 'Preview homepage must load the community frontend script');
const script = await get(target + '/script.js', 'Preview frontend script');
assert.equal(script.status, 200, 'Preview script.js must return HTTP 200, got ' + script.status);
const js = await script.text();
assert.match(js, /new URLSearchParams\(window\.location\.search\)\.get\('verify'\)/, 'Preview frontend must read the verification token from the query string');
assert.match(js, /community-verify-confirm/, 'Preview frontend must wire the verification confirmation control');
console.log('PASS: Preview homepage and script.js serve the email-verification UI and read query-string tokens.');
