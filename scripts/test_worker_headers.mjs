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

// Branch Previews must serve their own frontend assets rather than the production Pages copy.
const beforePreviewFetch = globalThis.fetch;
let previewPagesCalls = 0;
globalThis.fetch = async () => {
  previewPagesCalls += 1;
  throw new Error('Preview must not fetch the production Pages homepage');
};
let previewHomepage;
try {
  previewHomepage = await worker.fetch(new Request('https://feature-required-email-verification-ai-thuc-chien-blog.manhdungub.workers.dev/?verify=fake-preview-token#cong-dong'), {
    ASSETS: { fetch: async (request) => {
      assert.equal(new URL(request.url).pathname, '/index.html');
      return new Response('<button id="community-verify-confirm">Xác nhận email</button>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } },
  });
} finally {
  globalThis.fetch = beforePreviewFetch;
}
assert.equal(previewPagesCalls, 0, 'Branch Preview must not call the production Pages fallback');
assert.equal(previewHomepage.status, 200);
assert.match(await previewHomepage.text(), /community-verify-confirm/, 'Branch Preview must serve its own verification UI');
assert.equal(previewHomepage.headers.get('x-robots-tag'), 'noindex, nofollow', 'Branch Preview must not be indexed as a duplicate of Production');
assertSecurityHeaders(previewHomepage);

// Canonical Production homepage must use this exact Worker version's ASSETS,
// never the independently hosted Pages copy (which can contain stale JavaScript).
const beforePrimaryFetch = globalThis.fetch;
let productionPagesCalls = 0;
globalThis.fetch = async () => {
  productionPagesCalls += 1;
  throw new Error('Production homepage must not proxy the Pages fallback');
};
let root;
try {
  root = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/'), {
    ASSETS: { fetch: async (request) => {
      assert.equal(new URL(request.url).pathname, '/index.html');
      return new Response('<script src="script.js"></script><h1>Current Worker homepage</h1>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } },
  });
} finally {
  globalThis.fetch = beforePrimaryFetch;
}
assert.equal(productionPagesCalls, 0, 'Production homepage must not fetch the Pages copy');
assert.equal(root.status, 200);
assert.match(await root.text(), /Current Worker homepage/);
assert.equal(root.headers.get('location'), null, 'Root must not redirect to /index.html');
assert.equal(root.headers.get('cache-control'), 'no-store, max-age=0');
assert.equal(root.headers.get('pragma'), 'no-cache');
assert.equal(root.headers.get('expires'), '0');
assert.equal(root.headers.get('x-robots-tag'), null, 'Canonical Production host must remain indexable');
assertSecurityHeaders(root);


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
assertSecurityHeaders(htmlNotFound);

// Cloudflare's configured 404-page handler can make a missing static file look
// like an HTML response. Do not redirect file-like requests such as .js to /.
const missingScript = await worker.fetch(new Request('https://example.test/missing-script.js?source=asset', {
  headers: { Accept: '*/*' },
}), {
  ASSETS: { fetch: async () => new Response('<title>Not found</title>', {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }) },
});
assert.equal(missingScript.status, 404, 'Missing static files should not redirect even if Cloudflare returns an HTML 404 page');
assert.equal(missingScript.headers.get('location'), null);
assertSecurityHeaders(missingScript);

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


const chatRateRows = new Map();
const chatDb = {
  prepare(sql) {
    return { bind(...args) {
      if (sql.startsWith('INSERT INTO community_rate_limits')) {
        const [bucket, windowStart] = args;
        return { run: async () => {
          const old = chatRateRows.get(bucket);
          chatRateRows.set(bucket, { count: old && old.window_start === windowStart ? old.count + 1 : 1, window_start: windowStart });
          return { meta: { changes: 1 } };
        } };
      }
      if (sql.startsWith('SELECT count FROM community_rate_limits')) {
        const [bucket] = args;
        return { first: async () => chatRateRows.get(bucket) || null };
      }
      throw new Error('Unexpected chat D1 query: ' + sql);
    } };
  },
};

const chatRequest = new Request('https://example.test/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Origin': 'https://ai-thuc-chien-blog.manhdungub.workers.dev', 'CF-Connecting-IP': '198.51.100.44' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Tôi nên bắt đầu học AI từ đâu?' }], page: { title: 'Bắt đầu với AI', path: '/articles/bat-dau-voi-ai' } }),
});
const chat = await worker.fetch(chatRequest, {
  DB: chatDb,
  AI: { run: async (model, input) => {
    assert.equal(model, '@cf/meta/llama-3.1-8b-instruct-fast');
    assert.equal(input.messages.at(-1).content, 'Tôi nên bắt đầu học AI từ đâu?');
    assert.match(input.messages[0].content, /Bắt đầu với AI: hướng dẫn thực hành cho người mới/);
    assert.match(input.messages[0].content, /tiêu đề=Bắt đầu với AI; đường dẫn=\/articles\/bat-dau-voi-ai/);
    return { response: 'Hãy bắt đầu với một tác vụ nhỏ và kiểm chứng kết quả.' };
  } },
  ASSETS: { fetch: async () => new Response('unexpected asset fetch', { status: 500 }) },
});
assert.equal(chat.status, 200);
assert.equal((await chat.json()).answer, 'Hãy bắt đầu với một tác vụ nhỏ và kiểm chứng kết quả.');
assert.equal(chat.headers.get('cache-control'), 'no-store');
assert.equal(chat.headers.get('access-control-allow-origin'), 'https://ai-thuc-chien-blog.manhdungub.workers.dev');
assertSecurityHeaders(chat);

const badOrigin = await worker.fetch(new Request('https://example.test/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://evil.example' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
}), { AI: { run: async () => ({ response: 'no' }) }, ASSETS: { fetch: async () => new Response('asset') } });
assert.equal(badOrigin.status, 403);
assert.equal((await badOrigin.json()).error, 'Nguồn yêu cầu không được phép.');

const noAi = await worker.fetch(new Request('https://example.test/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ai-thuc-chien-blog.manhdungub.workers.dev' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
}), { ASSETS: { fetch: async () => new Response('asset') } });
assert.equal(noAi.status, 503);
console.log('PASS: reader chat API validation, model call, same-origin policy, no-store, and graceful missing-binding response');
