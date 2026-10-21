#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';

const configured = String(process.env.PREVIEW_URL || '');
if (!configured) throw new Error('PREVIEW_URL is required.');
const base = new URL(configured);
const expectedHost = 'feature-required-email-verification-ai-thuc-chien-blog.workers.dev';
if (base.protocol !== 'https:' || base.hostname !== expectedHost || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Safety stop: this smoke test only targets the expected feature Preview hostname.');
}
const target = base.origin;

async function requestWithRetry(url, init, label) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch (error) {
      lastError = error;
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw new Error(`${label} could not reach the Preview endpoint after retries (${String(lastError?.name || 'network error')}).`);
}

// Read-only, same-origin request: proves the preview worker, D1 schema and CORS work together.
const own = await requestWithRetry(`${target}/api/community/me`, {
  method: 'GET',
  headers: { Origin: target, Accept: 'application/json' },
}, 'Same-origin request');
assert.equal(own.status, 200, `Same-origin /me must return HTTP 200, got ${own.status}`);
assert.equal(own.headers.get('access-control-allow-origin'), target, 'CORS must return the exact Preview origin');
assert.equal(own.headers.get('access-control-allow-credentials'), 'true', 'CORS must support the secure session cookie');
const ownPayload = await own.json();
assert.equal(ownPayload.member, null, 'Unauthenticated read must not disclose member data');
console.log('PASS: Preview /api/community/me returns HTTP 200 with same-origin CORS and an empty unauthenticated member.');

// Read-only negative test: an unrelated origin must be rejected by the same endpoint.
const hostile = await requestWithRetry(`${target}/api/community/me`, {
  method: 'GET',
  headers: { Origin: 'https://untrusted.example', Accept: 'application/json' },
}, 'Cross-origin rejection request');
assert.equal(hostile.status, 403, `Untrusted origin must return HTTP 403, got ${hostile.status}`);
assert.equal(hostile.headers.get('access-control-allow-origin'), null, 'Untrusted origin must not receive CORS permission');
console.log('PASS: An untrusted cross-origin request is rejected with HTTP 403 and no CORS permission.');
