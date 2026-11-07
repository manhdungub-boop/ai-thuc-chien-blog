import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const js = readFileSync('script.js', 'utf8');

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
assert.match(handler, /passwordInput\.value = ''/, 'Password must be cleared after success.');

console.log('PASS: registration frontend contract — required controls, accessible status, submit handler, loading lock, API call, success/error feedback, password clearing');
