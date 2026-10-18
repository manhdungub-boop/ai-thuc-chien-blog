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
const response = await worker.fetch(request, {
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
});
assert.equal(response.status, 200);
const payload = await response.json();
assert.ok(assetCalls > 0, 'retrieval should fetch article content');
assert.equal(modelSawExcerpt, true, 'retrieved text should be included in the model prompt');
assert.match(payload.answer, /Bài viết tham khảo/);
assert.match(payload.answer, /https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/articles\/kiem-chung-noi-dung-ai/);
console.log('PASS: relevant article text is retrieved, sent to AI, and cited with a validated URL');
