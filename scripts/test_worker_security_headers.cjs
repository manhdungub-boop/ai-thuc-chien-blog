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

  let receivedRequest;
  const request = new Request('https://example.test/articles/demo');
  const original = new Response('<h1>Example</h1>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Test-Preserved': 'yes' },
  });
  const response = await worker.fetch(request, {
    ASSETS: { fetch: async (incoming) => { receivedRequest = incoming; return original; } },
  });

  assert.equal(receivedRequest, request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('X-Test-Preserved'), 'yes');
  assert.equal(await response.text(), '<h1>Example</h1>');
  for (const [name, value] of Object.entries(expected)) assert.equal(response.headers.get(name), value, name);

  const notFound = new Response('not found', { status: 404 });
  const notFoundResponse = await worker.fetch(new Request('https://example.test/missing'), {
    ASSETS: { fetch: async () => notFound },
  });
  assert.equal(notFoundResponse.status, 404);
  assert.equal(notFoundResponse.headers.get('X-Frame-Options'), 'DENY');

  const httpResponse = await worker.fetch(new Request('http://example.test/'), {
    ASSETS: { fetch: async () => new Response('ok') },
  });
  assert.equal(httpResponse.headers.get('Strict-Transport-Security'), null);
  assert.equal(httpResponse.headers.get('X-Content-Type-Options'), 'nosniff');

  console.log('PASS: security headers on assets and 404; preserves status/body/content-type/custom headers; HSTS only over HTTPS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
