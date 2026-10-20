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

const beforePrimaryPages = globalThis.fetch;
let primaryPagesCalls = 0;
globalThis.fetch = async (input, init = {}) => {
  const pagesUrl = new URL(typeof input === 'string' ? input : input.url);
  primaryPagesCalls += 1;
  assert.equal(pagesUrl.hostname, 'ai-thuc-chien-blog.pages.dev');
  assert.equal(pagesUrl.pathname, '/');
  assert.equal(init.method, 'GET');
  return new Response('<title>AI Thực Chiến — Ứng dụng AI vào việc thật</title>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
let root;
try {
  root = await worker.fetch(new Request('https://example.test/'), {
    ASSETS: { fetch: async () => { throw new Error('Root should prefer the verified Pages homepage'); } },
  });
} finally {
  globalThis.fetch = beforePrimaryPages;
}
assert.equal(primaryPagesCalls, 1, 'Homepage should prefer the Pages origin exactly once');
assert.equal(root.status, 200);
assert.equal(await root.text(), '<title>AI Thực Chiến — Ứng dụng AI vào việc thật</title>');
assert.equal(root.headers.get('location'), null, 'Root must not redirect to /index.html');
assert.equal(root.headers.get('cache-control'), 'no-store, max-age=0');
assert.equal(root.headers.get('pragma'), 'no-cache');
assert.equal(root.headers.get('expires'), '0');
assertSecurityHeaders(root);

// If the Worker asset binding returns a 404 for the homepage, recover from the
// independently hosted Pages copy without redirecting the visitor or touching D1.
const originalFetch = globalThis.fetch;
let fallbackCalls = 0;
globalThis.fetch = async (input, init = {}) => {
  const fallbackUrl = new URL(typeof input === 'string' ? input : input.url);
  fallbackCalls += 1;
  assert.equal(fallbackUrl.hostname, 'ai-thuc-chien-blog.pages.dev');
  assert.equal(fallbackUrl.pathname, '/');
  assert.equal(init.method, 'GET');
  if (fallbackCalls === 1) return new Response('Temporary Pages error', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return new Response('<title>AI Thực Chiến — Ứng dụng AI vào việc thật</title>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
let recoveredHomepage;
try {
  recoveredHomepage = await worker.fetch(new Request('https://example.test/?diag=fallback'), {
    ASSETS: { fetch: async (request) => {
      assert.equal(new URL(request.url).pathname, '/index.html');
      return new Response('<h1>404</h1>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } },
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(recoveredHomepage.status, 200, 'Homepage fallback should recover an asset 404');
assert.match(await recoveredHomepage.text(), /AI Thực Chiến/);
assert.equal(fallbackCalls, 2, 'Homepage should retry Pages after its initial request fails');
assert.equal(recoveredHomepage.headers.get('cache-control'), 'no-store, max-age=0');
assertSecurityHeaders(recoveredHomepage);

// Also recover when a fallback layer incorrectly serves the branded 404 document
// with status 200 (the failure pattern reported on iPhone).
fallbackCalls = 0;
globalThis.fetch = async (input, init = {}) => {
  const fallbackUrl = new URL(typeof input === 'string' ? input : input.url);
  fallbackCalls += 1;
  assert.equal(fallbackUrl.hostname, 'ai-thuc-chien-blog.pages.dev');
  assert.equal(fallbackUrl.pathname, '/');
  assert.equal(init.method, 'GET');
  if (fallbackCalls === 1) return new Response('Temporary Pages error', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return new Response('<title>AI Thực Chiến — Ứng dụng AI vào việc thật</title>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
let recoveredBranded404;
try {
  recoveredBranded404 = await worker.fetch(new Request('https://example.test/?diag=branded-404'), {
    ASSETS: { fetch: async (request) => {
      assert.equal(new URL(request.url).pathname, '/index.html');
      return new Response('<h1>LỖI 404 · KHÔNG TÌM THẤY TRANG</h1><p>Có vẻ đường dẫn đã đi lạc.</p>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } },
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(recoveredBranded404.status, 200, 'Branded 404 returned as HTTP 200 should recover');
const recoveredBrandedBody = await recoveredBranded404.text();
assert.match(recoveredBrandedBody, /AI Thực Chiến/);
assert.equal(fallbackCalls, 2, 'Branded HTTP 200 404 should retry Pages after initial fetch failure');
assert.equal(recoveredBranded404.headers.get('cache-control'), 'no-store, max-age=0');
assertSecurityHeaders(recoveredBranded404);

const ok = await worker.fetch(new Request('https://example.test/index.html'), {
  ASSETS: {
    fetch: async (request) => {
      assert.equal(new URL(request.url).pathname, '/index.html');
      return new Response('<h1>OK</h1>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          'ETag': '\"abc123\"',
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
assert.equal(ok.headers.get('etag'), '\"abc123\"');

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

// HTML 404s should recover even when a browser/WebView sends Accept: */* and
// the invalid route ends in .html. Keep non-HTML/missing static assets as 404.
const htmlNotFound = await worker.fetch(new Request('https://example.test/missing-page.html?source=webview', {
  headers: { Accept: '*/*' },
}), {
  ASSETS: { fetch: async () => new Response('<title>Không tìm thấy trang</title><h1>LỖI 404</h1>', {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }) },
});
assert.equal(htmlNotFound.status, 302, 'HTML 404 route should redirect independent of Accept and path suffix');
assert.equal(htmlNotFound.headers.get('location'), 'https://example.test/?source=webview');
assert.equal(htmlNotFound.headers.get('cache-control'), 'no-store, max-age=0');
assertSecuri
... (output truncated, full output saved to: /mnt/files/.composio/output/bash_nuts_stdout.txt)
Run 'cat /mnt/files/.composio/output/bash_nuts_stdout.txt' to view the full output, or use 'head -n 100 /mnt/files/.composio/output/bash_nuts_stdout.txt' / 'tail -n 100 /mnt/files/.composio/output/bash_nuts_stdout.txt' to view parts of it.