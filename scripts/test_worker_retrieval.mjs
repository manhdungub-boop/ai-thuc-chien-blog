#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const request = new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://ai-thuc-chien-blog.manhdungub.workers.dev',
    'CF-Connecting-IP': '198.51.100.89',
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Làm sao kiểm chứng nội dung AI trước khi xuất bản?' }],
    page: { title: 'Trang chủ', path: '/' },
  }),
});
let assetCalls = 0;
let modelSawExcerpt = false;
const rateRows = new Map();
const DB = {
  prepare(sql) {
    return {
      bind(...args) {
        if (sql.startsWith("INSERT INTO community_rate_limits")) {
          const [bucket, windowStart] = args;
          return { run: async () => {
            const previous = rateRows.get(bucket);
            rateRows.set(bucket, { count: previous && previous.window_start === windowStart ? previous.count + 1 : 1, window_start: windowStart });
            return { meta: { changes: 1 } };
          } };
        }
        if (sql.startsWith("SELECT count FROM community_rate_limits")) {
          const [bucket] = args;
          return { first: async () => rateRows.get(bucket) || null };
        }
        throw new Error("Unexpected D1 query in chat test: " + sql);
      },
    };
  },
};
const env = {
  DB,
  ASSETS: {
    fetch: async (assetRequest) => {
      assetCalls += 1;
      assert.match(new URL(assetRequest.url).pathname, /^\/articles\/[a-z0-9-]+\.html$/);
      return new Response('<html><body><h1>Checklist kiểm chứng nội dung AI</h1><p>Trước khi xuất bản, hãy kiểm tra các dữ kiện, số liệu, ngày tháng và trích dẫn do AI tạo bằng nguồn đáng tin cậy.</p><p>Ghi lại nguồn và nhờ người có chuyên môn kiểm tra các tuyên bố quan trọng.</p></body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },
  },
  AI: {
    run: async (_model, input) => {
      modelSawExcerpt = input.messages[0].content.includes('Trước khi xuất bản, hãy kiểm tra các dữ kiện');
      return { response: 'Hãy kiểm tra từng dữ kiện quan trọng và đối chiếu với nguồn đáng tin cậy.' };
    },
  },
};
const response = await worker.fetch(request, env);
assert.equal(response.status, 200);
const payload = await response.json();
assert.ok(assetCalls > 0, 'retrieval should fetch article content');
assert.equal(modelSawExcerpt, true, 'retrieved text should be included in the model prompt');
assert.match(payload.answer, /Bài viết tham khảo/);
assert.match(payload.answer, /https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/articles\/kiem-chung-noi-dung-ai/);


const missingOrigin = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.90' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Xin chào' }] }),
}), env);
assert.equal(missingOrigin.status, 403, 'chat API must reject browser requests without an allowed Origin');

const rejectedOrigin = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example', 'CF-Connecting-IP': '198.51.100.91' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Xin chào' }] }),
}), env);
assert.equal(rejectedOrigin.status, 403, 'chat API must reject untrusted origins');

let oversizedStreamCancelled = false;
const oversizedBody = new ReadableStream({
  start(controller) { controller.enqueue(new Uint8Array(12001)); },
  cancel() { oversizedStreamCancelled = true; },
});
const oversizedResponse = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ai-thuc-chien-blog.manhdungub.workers.dev', 'CF-Connecting-IP': '198.51.100.92' },
  body: oversizedBody, duplex: 'half',
}), env);
assert.equal(oversizedResponse.status, 413, 'oversized streamed chat bodies must be rejected');
assert.equal(oversizedStreamCancelled, true, 'oversized request stream must be cancelled without buffering the remainder');

const rateLimitedIp = '198.51.100.93';
for (let index = 0; index < 10; index += 1) {
  const allowed = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ai-thuc-chien-blog.manhdungub.workers.dev', 'CF-Connecting-IP': rateLimitedIp },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Xin chào' }] }),
  }), env);
  assert.equal(allowed.status, 200, 'the first ten requests in a minute should be allowed');
}
const blocked = await worker.fetch(new Request('https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ai-thuc-chien-blog.manhdungub.workers.dev', 'CF-Connecting-IP': rateLimitedIp },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Xin chào' }] }),
}), env);
assert.equal(blocked.status, 429, 'the eleventh request from one IP in a minute must be rate-limited by D1');

console.log('PASS: chat retrieval, strict origin checks, streamed body cap, D1-backed per-IP throttling and validated citations');
