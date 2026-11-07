#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../worker.mjs';

// Local Node may accept PBKDF2 counts that deployed Cloudflare Workers reject.
// Guard the platform ceiling explicitly so the test suite catches this regression.
const workerSource = fs.readFileSync(new URL('../worker.mjs', import.meta.url), 'utf8');
const pbkdf2IterationsMatch = workerSource.match(/const COMMUNITY_PASSWORD_ITERATIONS = (\d+);/);
assert.ok(pbkdf2IterationsMatch, 'Community PBKDF2 iteration setting must be explicit');
assert.ok(Number(pbkdf2IterationsMatch[1]) <= 100000,
  'Cloudflare Workers supports at most 100,000 PBKDF2 iterations per deriveBits call');
assert.match(workerSource, /iterations:\s*COMMUNITY_PASSWORD_ITERATIONS/,
  'Password hashing must use the checked PBKDF2 iteration setting');
class MockD1 {
  constructor() { this.members = []; this.sessions = []; this.messages = []; this.emailVerificationTokens = []; this.emailVerificationStatus = []; this.passwordResetTokens = []; this.rates = new Map(); }
  prepare(sql) {
    const db = this; let args = [];
    return {
      bind(...values) { args = values; return this; },
      async run() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('INSERT INTO community_rate_limits')) { const [bucket, windowStart] = args; const old = db.rates.get(bucket); db.rates.set(bucket, { count: old && old.window_start === windowStart ? old.count + 1 : 1, window_start: windowStart }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_members')) { const [id, username, email, display_name, password_salt, password_hash, created_at] = args; if (db.members.some((m) => m.email === email || m.username === username)) throw new Error('unique constraint'); db.members.push({ id, username, email, display_name, password_salt, password_hash, created_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_email_verification_status')) { const [member_id, created_at] = args; db.emailVerificationStatus.push({ member_id, verified_at: null, created_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('UPDATE community_email_verification_status SET verified_at = ? WHERE member_id = ?')) { const [verified_at, member_id] = args; const row = db.emailVerificationStatus.find((r) => r.member_id === member_id && r.verified_at === null); if (!row) return { meta: { changes: 0 } }; row.verified_at = verified_at; return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_email_verification_tokens')) { const [token_hash, member_id, created_at, expires_at] = args; db.emailVerificationTokens.push({ token_hash, member_id, created_at, expires_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_email_verification_tokens WHERE token_hash = ?')) { const before = db.emailVerificationTokens.length; db.emailVerificationTokens = db.emailVerificationTokens.filter((r) => r.token_hash !== args[0]); return { meta: { changes: before - db.emailVerificationTokens.length } }; }
        if (q.startsWith('DELETE FROM community_email_verification_tokens WHERE member_id = ?')) { const before = db.emailVerificationTokens.length; db.emailVerificationTokens = db.emailVerificationTokens.filter((r) => r.member_id !== args[0]); return { meta: { changes: before - db.emailVerificationTokens.length } }; }
        if (q.startsWith('DELETE FROM community_members WHERE id = ?')) { const before = db.members.length; db.members = db.members.filter((m) => m.id !== args[0]); db.emailVerificationTokens = db.emailVerificationTokens.filter((r) => r.member_id !== args[0]); db.emailVerificationStatus = db.emailVerificationStatus.filter((r) => r.member_id !== args[0]); return { meta: { changes: before - db.members.length } }; }
        if (q.startsWith('UPDATE community_members SET email_verified_at = ? WHERE id = ?')) { const [email_verified_at, id] = args; const member = db.members.find((m) => m.id === id); if (!member) return { meta: { changes: 0 } }; member.email_verified_at = email_verified_at; return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_sessions')) { const [id, member_id, token_hash, created_at, expires_at] = args; db.sessions.push({ id, member_id, token_hash, created_at, expires_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_messages')) { const [id, topic, member_id, body, created_at] = args; db.messages.push({ id, topic, member_id, body, created_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_password_reset_tokens')) { const [token_hash, member_id, created_at, expires_at] = args; if (db.passwordResetTokens.some((r) => r.token_hash === token_hash)) throw new Error('unique constraint'); db.passwordResetTokens.push({ token_hash, member_id, created_at, expires_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_password_reset_tokens WHERE member_id = ?')) { const before = db.passwordResetTokens.length; db.passwordResetTokens = db.passwordResetTokens.filter((r) => r.member_id !== args[0]); return { meta: { changes: before - db.passwordResetTokens.length } }; }
        if (q.startsWith('DELETE FROM community_password_reset_tokens WHERE expires_at <= ?')) { const before = db.passwordResetTokens.length; db.passwordResetTokens = db.passwordResetTokens.filter((r) => r.expires_at > args[0]); return { meta: { changes: before - db.passwordResetTokens.length } }; }
        if (q.startsWith('DELETE FROM community_password_reset_tokens WHERE token_hash = ?')) { const before = db.passwordResetTokens.length; db.passwordResetTokens = db.passwordResetTokens.filter((r) => r.token_hash !== args[0]); return { meta: { changes: before - db.passwordResetTokens.length } }; }
        
        
        
        if (q.startsWith('UPDATE community_members SET password_salt = ?, password_hash = ? WHERE id = ?')) { const [password_salt, password_hash, id] = args; const member = db.members.find((m) => m.id === id); if (!member) return { meta: { changes: 0 } }; member.password_salt = password_salt; member.password_hash = password_hash; return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE member_id = ?')) { const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.member_id !== args[0]); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE expires_at <=')) { const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.expires_at > args[0]); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE token_hash =')) { const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.token_hash !== args[0]); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('DELETE FROM community_messages')) { const before = db.messages.length; db.messages = db.messages.filter((m) => !(m.id === args[0] && m.member_id === args[1])); return { meta: { changes: before - db.messages.length } }; }
        throw new Error('MockD1 unexpected run: ' + q);
      },
      async first() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT count FROM community_rate_limits')) return db.rates.get(args[0]) || null;
        if (q.startsWith('SELECT m.id, m.username, m.email, m.display_name, m.password_salt, m.password_hash, m.created_at, v.verified_at FROM community_members')) { const member = db.members.find((m) => m.email === args[0]); if (!member) return null; const status = db.emailVerificationStatus.find((r) => r.member_id === member.id); return { ...member, verified_at: status?.verified_at || null }; }
        if (q.startsWith('SELECT id, email FROM community_members')) return db.members.find((m) => m.email === args[0]) ? (({id,email}) => ({id,email}))(db.members.find((m) => m.email === args[0])) : null;
        if (q.startsWith('DELETE FROM community_email_verification_tokens WHERE token_hash = ? AND expires_at > ? RETURNING member_id')) { const [token_hash, now] = args; const index = db.emailVerificationTokens.findIndex((r) => r.token_hash === token_hash && r.expires_at > now); if (index < 0) return null; const [row] = db.emailVerificationTokens.splice(index, 1); return { member_id: row.member_id }; }
        if (q.startsWith('DELETE FROM community_password_reset_tokens WHERE token_hash = ? AND expires_at > ? RETURNING member_id')) { const [token_hash, now] = args; const index = db.passwordResetTokens.findIndex((r) => r.token_hash === token_hash && r.expires_at > now); if (index < 0) return null; const [row] = db.passwordResetTokens.splice(index, 1); return { member_id: row.member_id }; }
        if (q.startsWith('SELECT m.id, m.username, m.display_name, m.created_at FROM community_sessions')) { const session = db.sessions.find((s) => s.token_hash === args[0] && s.expires_at > args[1]); const member = session && db.members.find((m) => m.id === session.member_id); return member ? { id: member.id, username: member.username, display_name: member.display_name, created_at: member.created_at } : null; }
        throw new Error('MockD1 unexpected first: ' + q);
      },
      async all() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT cm.id, cm.topic, cm.body, cm.created_at, m.username, m.display_name, cm.member_id')) return { results: db.messages.filter((msg) => msg.topic === args[0]).sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,50).map((msg) => { const m = db.members.find((member) => member.id === msg.member_id); return { ...msg, username: m.username, display_name: m.display_name }; }) };
        throw new Error('MockD1 unexpected all: ' + q);
      }
    };
  }
}
const origin = 'https://ai-thuc-chien-blog.manhdungub.workers.dev';
const db = new MockD1(); const env = { DB: db, ASSETS: { fetch: async () => new Response('asset') }, COMMUNITY_EMAIL_RELAY_URL: 'https://relay.example.test/exec', COMMUNITY_EMAIL_RELAY_SECRET: 'test-only-secret-not-a-real-credential-value' };
const call = (path, { method = 'GET', body, cookie, originHeader = origin } = {}) => worker.fetch(new Request(`${origin}/api/community${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(originHeader ? { Origin: originHeader } : {}), 'CF-Connecting-IP': '198.51.100.77' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
const unconfigured = await worker.fetch(new Request('https://example.test/api/community/me'), {}); assert.equal(unconfigured.status, 503); assert.match((await unconfigured.json()).error, /cơ sở dữ liệu/i);
const badOrigin = await call('/register', { method: 'POST', originHeader: 'https://evil.example', body: {} }); assert.equal(badOrigin.status, 403);
const invalidRegister = await call('/register', { method: 'POST', body: { username: 'x', displayName: 'X', email: 'bad', password: 'short' } }); assert.equal(invalidRegister.status, 400);
const nullPayload = await call('/register', { method: 'POST', body: null }); assert.equal(nullPayload.status, 400);
const originalFetch = globalThis.fetch;
let sentVerificationPayload = null;
let sentResetPayload = null;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), env.COMMUNITY_EMAIL_RELAY_URL);
  const payload = JSON.parse(options.body);
  if (payload.subject === 'Xác nhận email — AI Thực Chiến') sentVerificationPayload = payload;
  else if (payload.subject === 'Đặt lại mật khẩu — AI Thực Chiến') sentResetPayload = payload;
  else throw new Error('Unexpected email relay subject');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const registered = await call('/register', { method: 'POST', body: { username: 'thanhvien_1', displayName: 'Thành viên thử', email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(registered.status, 201);
const registeredPayload = await registered.json(); assert.equal(registeredPayload.verificationRequired, true); assert.equal(registeredPayload.ok, true); assert.equal(JSON.stringify(registeredPayload).includes('MotMatKhauRieng123!'), false);
assert.equal(registered.headers.get('set-cookie'), null, 'Pending registration must not create a login session.');
assert.equal(sentVerificationPayload.to, 'member@example.com');
assert.equal(sentVerificationPayload.secret, env.COMMUNITY_EMAIL_RELAY_SECRET);
assert.equal(sentVerificationPayload.subject, 'Xác nhận email — AI Thực Chiến');
const verifyUrl = new URL(sentVerificationPayload.verifyUrl); assert.equal(verifyUrl.origin, origin); assert.equal(verifyUrl.pathname, '/api/community/verify-email');
const verifyToken = verifyUrl.searchParams.get('token'); assert.match(verifyToken, /^[A-Za-z0-9_-]{32,80}$/);
assert.ok(sentVerificationPayload.textBody.includes(sentVerificationPayload.verifyUrl));
assert.ok(sentVerificationPayload.htmlBody.includes('href="' + sentVerificationPayload.verifyUrl + '"'));
const landing = await worker.fetch(new Request(sentVerificationPayload.verifyUrl), env); assert.equal(landing.status, 200); assert.match(await landing.text(), /Xác nhận email/);
const pendingLogin = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(pendingLogin.status, 403);
const confirmed = await call('/verify-email', { method: 'POST', body: { token: verifyToken } }); assert.equal(confirmed.status, 200); assert.equal((await confirmed.json()).ok, true);
assert.equal(db.emailVerificationTokens.length, 0);
const verificationReplay = await call('/verify-email', { method: 'POST', body: { token: verifyToken } }); assert.equal(verificationReplay.status, 400, 'A verification token must be single-use.');
const login = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(login.status, 200); const loginPayload = await login.json(); assert.equal(loginPayload.member.username, 'thanhvien_1');
const setCookie = login.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Path=\//); const cookie = setCookie.split(';')[0];
const me = await call('/me', { cookie }); assert.equal(me.status, 200); assert.equal((await me.json()).member.username, 'thanhvien_1');
const sent = await call('/messages', { method: 'POST', cookie, body: { topic: 'automation', body: 'Tôi đang thử một workflow có bước duyệt.' } }); assert.equal(sent.status, 201); assert.equal((await sent.json()).message.topic, 'automation');
const listed = await call('/messages?topic=automation', { cookie }); assert.equal(listed.status, 200); const listedPayload = await listed.json(); assert.equal(listedPayload.messages.length, 1); assert.equal(listedPayload.messages[0].own, true);
const removed = await call(`/messages/${listedPayload.messages[0].id}`, { method: 'DELETE', cookie }); assert.equal(removed.status, 200); assert.equal(db.messages.length, 0);
const badTopic = await call('/messages?topic=unknown', { cookie }); assert.equal(badTopic.status, 400);
const badMessage = await call('/messages', { method: 'POST', cookie, body: { topic: 'tools', body: '   ' } }); assert.equal(badMessage.status, 400);
const wrongPassword = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'sai-mat-khau' } }); assert.equal(wrongPassword.status, 401);
try {
  const resetRequest = await call('/password-reset/request', { method: 'POST', body: { email: 'member@example.com' } });
  assert.equal(resetRequest.status, 200);
  const resetRequestPayload = await resetRequest.json();
  assert.equal(resetRequestPayload.ok, true);
  assert.match(resetRequestPayload.message, /Nếu email này có tài khoản hợp lệ/);
  assert.equal(sentResetPayload.to, 'member@example.com');
  assert.equal(sentResetPayload.secret, env.COMMUNITY_EMAIL_RELAY_SECRET);
  assert.equal(sentResetPayload.subject, 'Đặt lại mật khẩu — AI Thực Chiến');
  const resetUrl = new URL(sentResetPayload.verifyUrl);
  assert.equal(resetUrl.origin, origin);
  const resetToken = resetUrl.searchParams.get('reset');
  assert.match(resetToken, /^[A-Za-z0-9_-]{32,80}$/);
  assert.ok(sentResetPayload.textBody.includes(sentResetPayload.verifyUrl));
  assert.ok(sentResetPayload.htmlBody.includes('href="' + sentResetPayload.verifyUrl + '"'));

  const unknownReset = await call('/password-reset/request', { method: 'POST', body: { email: 'not-a-member@example.com' } });
  assert.equal(unknownReset.status, 200);
  assert.equal((await unknownReset.json()).message, resetRequestPayload.message);

  assert.ok(db.sessions.some((s) => s.member_id === loginPayload.member.id));
  assert.equal(db.passwordResetTokens.length, 1);
  const resetDone = await call('/password-reset/complete', { method: 'POST', body: { token: resetToken, password: 'MatKhauMoiTotHon123!' } });
  const resetDonePayload = await resetDone.json();
  assert.equal(resetDone.status, 200, 'Password reset failed: ' + JSON.stringify(resetDonePayload));
  assert.equal(resetDonePayload.ok, true);
  assert.equal(db.passwordResetTokens.length, 0, 'A reset token must be consumed exactly once.');
  assert.equal(db.sessions.some((s) => s.member_id === loginPayload.member.id), false,
    'Password reset must revoke every existing session.');
  const replay = await call('/password-reset/complete', { method: 'POST', body: { token: resetToken, password: 'MatKhauKhacTotHon456!' } });
  assert.equal(replay.status, 400, 'A reset token must not be reusable.');
  const oldPasswordAfterReset = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'MotMatKhauRieng123!' } });
  assert.equal(oldPasswordAfterReset.status, 401);
  const newPasswordAfterReset = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'MatKhauMoiTotHon123!' } });
  assert.equal(newPasswordAfterReset.status, 200);

  const expiredResetToken = 'expired-reset-token-for-regression-test';
  const expiredTokenHash = createHash('sha256').update(expiredResetToken).digest('base64url');
  db.passwordResetTokens.push({
    token_hash: expiredTokenHash,
    member_id: loginPayload.member.id,
    created_at: '2000-01-01T00:00:00.000Z',
    expires_at: '2000-01-01T00:30:00.000Z'
  });
  const expiredReset = await call('/password-reset/complete', {
    method: 'POST',
    body: { token: expiredResetToken, password: 'KhongDuocChapNhan123!' }
  });
  assert.equal(expiredReset.status, 400, 'An expired reset token must be rejected.');
  assert.ok(db.passwordResetTokens.some((row) => row.token_hash === expiredTokenHash),
    'An expired token must not be consumed as a valid reset.');
  const passwordAfterExpiredReset = await call('/login', {
    method: 'POST',
    body: { email: 'member@example.com', password: 'MatKhauMoiTotHon123!' }
  });
  assert.equal(passwordAfterExpiredReset.status, 200,
    'An expired reset token must not change the current password.');
} finally {
  globalThis.fetch = originalFetch;
}
const logout = await call('/logout', { method: 'POST', cookie }); assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
console.log('PASS: community registration and explicit email verification, pending-login rejection, one-time verification tokens, login/logout, message authorization, origin protection, email reset delivery, generic responses, expiry-aware reset tokens, password replacement, and session revocation');
