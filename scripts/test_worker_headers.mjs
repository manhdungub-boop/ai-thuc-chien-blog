#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const requiredHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=()',
  'strict-transport-security': 'max-age=31536000',
};

function assertSecurityHeaders(response, expectHsts = true) {
  for (const [name, value] of Object.entries(requiredHeaders)) {
    if (name === 'strict-transport-security') {
      if (expectHsts) assert.equal(response.headers.get(name), value, 'unexpected HSTS value');
      else assert.equal(response.headers.get(name), null, 'HSTS must not be sent over HTTP');
    } else {
      assert.equal(response.headers.get(name), value, 'unexpected value for security header ' + name);
    }
  }
}

const ok = await worker.fetch(new Request('https://example.test/'), {
  ASSETS: {
    fetch: async (request) => {
      assert.equal(new URL(request.url).pathname, '/index.html');
      return new Response('<h1>OK</h1>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          'ETag': '"abc123"',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    },
  },
});
assert.equal(ok.status, 200);
assert.equal(await ok.text(), '<h1>OK</h1>');
assertSecurityHeaders(ok);
assert.equal(ok.headers.get('content-type'), 'text/html; charset=utf-8');
assert.equal(ok.headers.get('cache-control'), 'public, max-age=60');
assert.equal(ok.headers.get('etag'), '"abc123"');

const article = await worker.fetch(new Request('https://example.test/articles/sample-article'), {
  ASSETS: {
    fetch: async (request) => {
      assert.equal(new URL(request.url).pathname, '/articles/sample-article.html');
      return new Response('Article', { status: 200 });
    },
  },
});
assert.equal(article.status, 200);
assertSecurityHeaders(article);

const notFound = await worker.fetch(new Request('https://example.test/missing'), {
  ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) },
});
assert.equal(notFound.status, 404);
assert.equal(await notFound.text(), 'Not found');
assertSecurityHeaders(notFound);

const failure = await worker.fetch(new Request('https://example.test/error'), {
  ASSETS: { fetch: async () => { throw new Error('internal secret details'); } },
});
assert.equal(failure.status, 500);
const failureBody = await failure.text();
assert.match(failureBody, /Internal Server Error/);
assert.doesNotMatch(failureBody, /internal secret details/);
assert.equal(failure.headers.get('cache-control'), 'no-store');
assertSecurityHeaders(failure);

const httpResponse = await worker.fetch(new Request('http://example.test/'), {
  ASSETS: { fetch: async () => new Response('HTTP') },
});
assertSecurityHeaders(httpResponse, false);

console.log('PASS: security headers on 200/404/500, root and article routing, asset metadata preserved, internal error hidden, HSTS HTTPS-only');
