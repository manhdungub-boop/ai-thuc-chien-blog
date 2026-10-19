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

const root = await worker.fetch(new Request('https://example.test/'), {
  ASSETS: { fetch: async () => { throw new Error('Root must redirect before asset lookup'); } },
});
assert.equal(root.status, 302);
assert.equal(root.headers.get('location'), 'https://example.test/index.html');
assert.equal(root.headers.get('cache-control'), 'no-store, max-age=0');
assert.equal(root.headers.get('pragma'), 'no-cache');
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


const chatRequest = new Request('https://example.test/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Origin': 'https://ai-thuc-chien-blog.manhdungub.workers.dev', 'CF-Connecting-IP': '198.51.100.44' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Tôi nên bắt đầu học AI từ đâu?' }], page: { title: 'Bắt đầu với AI', path: '/articles/bat-dau-voi-ai' } }),
});
const chat = await worker.fetch(chatRequest, {
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
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
}), { ASSETS: { fetch: async () => new Response('asset') } });
assert.equal(noAi.status, 503);
console.log('PASS: reader chat API validation, model call, same-origin policy, no-store, and graceful missing-binding response');
