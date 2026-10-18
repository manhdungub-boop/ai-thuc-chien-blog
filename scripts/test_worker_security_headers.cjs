#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

(async () => {
  const { default: worker } = await import(pathToFileURL(path.join(root, 'worker.mjs')).href);
  const expected = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000',
  };

  const seen = [];
  const original = new Response('<h1>Example</h1>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Test-Preserved': 'yes' },
  });
  const request = new Request('https://example.test/articles/demo');
  const response = await worker.fetch(request, {
    ASSETS: { fetch: async (incoming) => { seen.push(incoming); return original; } },
  });

  assert.equal(seen[0].url, 'https://example.test/articles/demo.html', 'extensionless article routes must resolve to their .html asset');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('X-Test-Preserved'), 'yes');
  assert.equal(await response.text(), '<h1>Example</h1>');
  for (const [name, value] of Object.entries(expected)) assert.equal(response.headers.get(name), value, name);

  const htmlRequest = new Request('https://example.test/articles/demo.html');
  await worker.fetch(htmlRequest, { ASSETS: { fetch: async (incoming) => { seen.push(incoming); return original; } } });
  assert.equal(seen[1].url, htmlRequest.url, '.html URLs must not be rewritten');

  const missing = new Response('not found', { status: 404 });
  const missingResponse = await worker.fetch(new Request('https://example.test/missing'), { ASSETS: { fetch: async () => missing } });
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.headers.get('X-Frame-Options'), 'DENY');

  const httpResponse = await worker.fetch(new Request('http://example.test/'), {
    ASSETS: { fetch: async () => new Response('ok') },
  });
  assert.equal(httpResponse.headers.get('Strict-Transport-Security'), null);
  assert.equal(httpResponse.headers.get('X-Content-Type-Options'), 'nosniff');

  console.log('PASS: extensionless article routing, .html preservation, security headers, 404 handling, and HTTP HSTS behavior');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
