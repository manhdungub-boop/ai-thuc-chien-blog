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
assertSecurityHeaders(previewHomepage);

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
  root = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/'), {
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
  recoveredHomepage = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/?diag=fallback'), {
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
  recoveredBranded404 = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/?diag=branded-404'), {
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
