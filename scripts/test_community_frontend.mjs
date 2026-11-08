import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const js = readFileSync('script.js', 'utf8');
const liveE2E = readFileSync('scripts/test-live-staging-email-e2e.mjs', 'utf8');
const worker = readFileSync('worker.mjs', 'utf8');
const originMatch = liveE2E.match(/^const ORIGIN = "(https:\/\/[^"]+)";$/m);
assert.ok(originMatch, 'Live E2E must declare one explicit HTTPS Preview Worker origin.');
const expectedPreviewOrigin = 'https://fix-atomic-email-tokens-202-ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev';
assert.equal(originMatch[1], expectedPreviewOrigin, 'Live E2E must target the exact isolated branch Preview Worker deployed for this PR.');
assert.ok(worker.includes('"' + expectedPreviewOrigin + '"'), 'The isolated branch Preview Worker origin must be allowed by the community API CORS allowlist.');
assert.ok(!liveE2E.includes('fix-email-verification-prev-ai-thuc-chien-blog-auth-app-preview'), 'Live E2E must not target the superseded Preview hostname.');
 
for (const id of ['community-auth-form', 'community-auth-submit', 'community-auth-status', 'community-email', 'community-password']) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing registration UI element: ' + id);
}
assert.match(html, /id="community-auth-status"[^>]*role="status"/, 'Status must be announced accessibly.');

const start = js.indexOf("authForm.addEventListener('submit'");
const end = js.indexOf('logoutButton.addEventListener', start);
assert.ok(start >= 0 && end > start, 'Registration submit handler must be attached.');
const handler = js.slice(start, end);
assert.match(handler, /event\.preventDefault\(\)/, 'Submit must prevent navigation.');
assert.match(handler, /authSubmit\.disabled = true/, 'Button must lock while request is pending.');
assert.match(handler, /authSubmit\.disabled = false/, 'Button must unlock after request settles.');
assert.match(handler, /Đang tạo tài khoản an toàn/, 'Loading feedback must be shown.');
assert.match(handler, /api\('\/register'/, 'Registration API must be called.');
assert.match(handler, /result\.message \|\| .*'success'/, 'Success feedback must be shown.');
assert.match(handler, /error\.message, 'error'/, 'Failure feedback must be shown.');
assert.match(js, /catch \(error\) \{[\s\S]*?error instanceof TypeError[\s\S]*?Không thể kết nối đến máy chủ/, 'Network failures must produce clear Vietnamese feedback.');
assert.match(handler, /passwordInput\.value = ''/, 'Password must be cleared after success.');

console.log('PASS: registration frontend contract — required controls, accessible status, submit handler, loading lock, API call, success/error feedback, password clearing');
