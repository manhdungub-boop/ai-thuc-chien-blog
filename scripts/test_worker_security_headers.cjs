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
  const html = () => new Response('<h1>Example</h1>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Test-Preserved': 'yes' },
  });

  async function run(request, response = html()) {
    return worker.fetch(request, {
      ASSETS: { fetch: async (incoming) => { seen.push(incoming); return response; } },
    });
  }

  const canonical = new Request('https://example.test/articles/demo?from=test');
  const canonicalResponse = await run(canonical);
  assert.equal(seen.at(-1).url, 'https://example.test/articles/demo.html?from=test');
  assert.equal(canonicalResponse.status, 200);
  assert.equal(canonicalResponse.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(canonicalResponse.headers.get('X-Test-Preserved'), 'yes');
  assert.equal(await canonicalResponse.text(), '<h1>Example</h1>');
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(canonicalResponse.headers.get(name), value, name);
  }

  const htmlRequest = new Request('https://example.test/articles/demo.html');
  await run(htmlRequest);
  assert.equal(seen.at(-1).url, htmlRequest.url, '.html URLs must not be rewritten');

  const post = new Request('https://example.test/articles/demo?from=post', {
    method: 'POST',
    body: 'do-not-rewrite',
  });
  await run(post);
  assert.equal(seen.at(-1).url, post.url, 'POST requests must not be rewritten');
  assert.equal(seen.at(-1).method, 'POST');

  const asset = new Request('https://example.test/assets/site.css');
  await run(asset);
  assert.equal(seen.at(-1).url, asset.url, 'asset paths must not be rewritten');

  const missingResponse = await run(
    new Request('https://example.test/missing'),
    new Response('not found', { status: 404 }),
  );
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.headers.get('X-Frame-Options'), 'DENY');

  const httpResponse = await run(
    new Request('http://example.test/'),
    new Response('ok'),
  );
  assert.equal(httpResponse.headers.get('Strict-Transport-Security'), null);
  assert.equal(httpResponse.headers.get('X-Content-Type-Options'), 'nosniff');

  console.log('PASS: GET/HEAD article routing, query preservation, .html/assets/POST preservation, security headers, 404 handling, and HTTP HSTS behavior');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
