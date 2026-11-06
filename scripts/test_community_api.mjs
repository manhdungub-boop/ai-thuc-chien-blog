#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  constructor() { this.members = []; this.sessions = []; this.messages = []; this.tokens = []; this.resetTokens = []; this.rates = new Map(); }
  prepare(sql) {
    const db = this; let args = [];
    return {
      bind(...values) { args = values; return this; },
      async run() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('INSERT INTO community_rate_limits')) { const [bucket, windowStart] = args; const old = db.rates.get(bucket); db.rates.set(bucket, { count: old && old.window_start === windowStart ? old.count + 1 : 1, window_start: windowStart }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_members')) { const [id, username, email, display_name, password_salt, password_hash, created_at] = args; if (db.members.some((m) => m.email === email || m.username === username)) throw new Error('unique constraint'); db.members.push({ id, username, email, display_name, password_salt, password_hash, created_at, email_verified_at: null }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_email_verification_tokens')) { const [token_hash, member_id, created_at, expires_at] = args; db.tokens.push({ token_hash, member_id, created_at, expires_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_password_reset_tokens WHERE member_id =')) { const before = db.resetTokens.length; db.resetTokens = db.resetTokens.filter((t) => t.member_id !== args[0]); return { meta: { changes: before - db.resetTokens.length } }; }
        if (q.startsWith('INSERT INTO community_password_reset_tokens')) { const [token_hash, member_id, created_at, expires_at] = args; db.resetTokens.push({ token_hash, member_id, created_at, expires_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_email_verification_tokens WHERE member_id =')) { const before = db.tokens.length; db.tokens = db.tokens.filter((t) => t.member_id !== args[0]); return { meta: { changes: before - db.tokens.length } }; }
        if (q.startsWith('DELETE FROM community_email_verification_tokens WHERE token_hash =')) { const before = db.tokens.length; db.tokens = db.tokens.filter((t) => t.token_hash !== args[0]); return { meta: { changes: before - db.tokens.length } }; }
        if (q.startsWith('DELETE FROM community_members WHERE id =')) { const before = db.members.length; db.members = db.members.filter((m) => !(m.id === args[0] && !m.email_verified_at)); return { meta: { changes: before - db.members.length } }; }
        if (q.startsWith('UPDATE community_members SET email_verified_at =')) { const m = db.members.find((x) => x.id === args[1]); if (m && !m.email_verified_at) m.email_verified_at = args[0]; return { meta: { changes: m ? 1 : 0 } }; }
        if (q.startsWith('INSERT INTO community_sessions')) { const [id, member_id, token_hash, created_at, expires_at] = args; db.sessions.push({ id, member_id, token_hash, created_at, expires_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_messages')) { const [id, topic, member_id, body, created_at] = args; db.messages.push({ id, topic, member_id, body, created_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE expires_at <=')) { const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.expires_at > args[0]); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE token_hash =')) { const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.token_hash !== args[0]); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE member_id =')) { const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.member_id !== args[0]); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('UPDATE community_members SET password_salt =')) { const [password_salt, password_hash, id] = args; const member = db.members.find((m) => m.id === id); if (member) { member.password_salt = password_salt; member.password_hash = password_hash; } return { meta: { changes: member ? 1 : 0 } }; }
        if (q.startsWith('DELETE FROM community_messages')) { const before = db.messages.length; db.messages = db.messages.filter((m) => !(m.id === args[0] && m.member_id === args[1])); return { meta: { changes: before - db.messages.length } }; }
        throw new Error('MockD1 unexpected run: ' + q);
      },
      async first() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('DELETE FROM community_password_reset_tokens')) { const [tokenHash, now] = args; const tokenIndex = db.resetTokens.findIndex((t) => t.token_hash === tokenHash && t.expires_at > now); if (tokenIndex < 0) return null; const token = db.resetTokens[tokenIndex]; const member = db.members.find((m) => m.id === token.member_id && m.email_verified_at); if (!member) return null; db.resetTokens.splice(tokenIndex, 1); return { member_id: token.member_id }; }
        if (q.startsWith('SELECT count FROM community_rate_limits')) return db.rates.get(args[0]) || null;
        if (q.startsWith('SELECT id, username, email, display_name, password_salt, password_hash, created_at, email_verified_at FROM community_members')) return db.members.find((m) => m.email === args[0]) || null;
        if (q.startsWith('SELECT t.member_id, m.email, m.email_verified_at FROM community_email_verification_tokens')) { const t = db.tokens.find((x) => x.token_hash === args[0] && x.expires_at > args[1]); const m = t && db.members.find((x) => x.id === t.member_id); return m ? { member_id: m.id, email: m.email, email_verified_at: m.email_verified_at } : null; }
        if (q.startsWith('SELECT id, email, display_name, email_verified_at FROM community_members')) return db.members.find((m) => m.email === args[0]) || null;
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
const db = new MockD1(); const env = { DB: db, ASSETS: { fetch: async () => new Response('asset') }, COMMUNITY_EMAIL_RELAY_URL: 'https://mail-relay.example.test/exec', COMMUNITY_EMAIL_RELAY_SECRET: 'test-shared-secret' };
const originalFetch = globalThis.fetch; let capturedEmail = null; let relayResult = { ok: true };
globalThis.fetch = async (input, init = {}) => { if (String(input) === 'https://mail-relay.example.test/exec') { capturedEmail = JSON.parse(init.body); assert.equal(capturedEmail.secret, 'test-shared-secret'); return new Response(JSON.stringify(relayResult), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return originalFetch(input, init); };
const call = (path, { method = 'GET', body, cookie, originHeader = origin, ip = '198.51.100.77' } = {}) => worker.fetch(new Request(`https://example.test/api/community${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(originHeader ? { Origin: originHeader } : {}), 'CF-Connecting-IP': ip }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
const unconfigured = await worker.fetch(new Request('https://example.test/api/community/me'), {}); assert.equal(unconfigured.status, 503); assert.match((await unconfigured.json()).error, /cơ sở dữ liệu/i);
const badOrigin = await call('/register', { method: 'POST', originHeader: 'https://evil.example', body: {} }); assert.equal(badOrigin.status, 403);
const previewOrigin = 'https://feature-required-email-verification-ai-thuc-chien-blog.workers.dev';
const previewSameOriginResponse = await worker.fetch(new Request(`${previewOrigin}/api/community/me`, { headers: { Origin: previewOrigin } }), env);
assert.equal(previewSameOriginResponse.status, 200, 'same-origin Preview API calls should be accepted');
assert.equal(previewSameOriginResponse.headers.get('Access-Control-Allow-Origin'), previewOrigin);

const invalidRegister = await call('/register', { method: 'POST', body: { username: 'x', displayName: 'X', email: 'bad', password: 'short' } }); assert.equal(invalidRegister.status, 400);
const nullPayload = await call('/register', { method: 'POST', body: null }); assert.equal(nullPayload.status, 400);

// Missing relay config must fail closed before any member, token, or rate-limit write.
const oldRelayUrl = env.COMMUNITY_EMAIL_RELAY_URL;
const oldRelaySecret = env.COMMUNITY_EMAIL_RELAY_SECRET;
const countsBeforeNoRelay = [db.members.length, db.tokens.length, db.rates.size];
env.COMMUNITY_EMAIL_RELAY_URL = '';
env.COMMUNITY_EMAIL_RELAY_SECRET = '';
const noRelay = await call('/register', { method: 'POST', body: { username: 'no_relay_user', displayName: 'No Relay', email: 'no-relay@example.invalid', password: 'Temporary-No-Relay-Password-123!' } });
assert.equal(noRelay.status, 503);
assert.match((await noRelay.json()).error, /xác nhận email chưa được cấu hình/i);
assert.deepEqual([db.members.length, db.tokens.length, db.rates.size], countsBeforeNoRelay);
env.COMMUNITY_EMAIL_RELAY_URL = oldRelayUrl;
env.COMMUNITY_EMAIL_RELAY_SECRET = oldRelaySecret;
const registered = await call('/register', { method: 'POST', body: { username: 'thanhvien_1', displayName: 'Thành viên thử', email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(registered.status, 201);
const registeredPayload = await registered.json(); assert.equal(registeredPayload.verificationRequired, true); assert.equal(JSON.stringify(registeredPayload).includes('MotMatKhauRieng123!'), false); assert.equal(registered.headers.get('set-cookie'), null); assert.ok(capturedEmail); assert.equal(capturedEmail.to, 'member@example.com');
const loginBeforeVerification = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(loginBeforeVerification.status, 403); assert.equal((await loginBeforeVerification.json()).code, 'EMAIL_NOT_VERIFIED');
const tokenMatch = capturedEmail.htmlBody.match(/[?]verify=([A-Za-z0-9_-]{32,80})/); assert.ok(tokenMatch, 'verification email must contain a random one-time token'); const verify = await call('/verify-email', { method: 'POST', body: { token: tokenMatch[1] } }); assert.equal(verify.status, 200); assert.equal((await verify.json()).ok, true); assert.equal(db.tokens.length, 0);
const replay = await call('/verify-email', { method: 'POST', body: { token: tokenMatch[1] } }); assert.equal(replay.status, 400, 'verification tokens must be single-use');

// Resend is intentionally generic for account privacy and is rate-limited to three requests per email per hour.
const resendRegistration = await call('/register', { method: 'POST', body: { username: 'resend_user', displayName: 'Resend User', email: 'resend@example.com', password: 'Resend-Password-123!' } });
assert.equal(resendRegistration.status, 201);
const resendMessagesBefore = db.tokens.filter((t) => t.member_id === db.members.find((m) => m.email === 'resend@example.com').id).length;
assert.equal(resendMessagesBefore, 1);
for (let attempt = 0; attempt < 3; attempt += 1) {
  const resend = await call('/resend-verification', { method: 'POST', body: { email: 'resend@example.com' } });
  assert.equal(resend.status, 200, 'first three resend requests should return the generic response');
  assert.equal((await resend.json()).ok, true);
  assert.equal(capturedEmail.to, 'resend@example.com', 'pending account should receive a new verification email');
}
const resendLimited = await call('/resend-verification', { method: 'POST', body: { email: 'resend@example.com' } });
assert.equal(resendLimited.status, 429, 'fourth resend request in the same hour must be rate-limited');
assert.match((await resendLimited.json()).error, /quá nhiều lần/i);
const resendMember = db.members.find((m) => m.email === 'resend@example.com');
assert.equal(db.tokens.filter((t) => t.member_id === resendMember.id).length, 1, 'resend should replace the prior token rather than accumulating valid tokens');

// Password-reset email throttling must not reveal whether an email belongs to an account.
const resetEmail = 'privacy-reset@example.invalid';
for (let attempt = 0; attempt < 3; attempt += 1) {
  const response = await call('/password-reset/request', { method: 'POST', body: { email: resetEmail } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
}
const resetEmailLimited = await call('/password-reset/request', { method: 'POST', body: { email: resetEmail } });
assert.equal(resetEmailLimited.status, 200, 'email-specific throttling must keep the generic response');
assert.equal((await resetEmailLimited.json()).ok, true);
// The IP-wide limit remains enforced independently and applies regardless of the email value.
const resetOtherEmail = await call('/password-reset/request', { method: 'POST', body: { email: 'another-reset@example.invalid' } });
assert.equal(resetOtherEmail.status, 200, 'the fifth request from this IP should still be allowed');
const resetIpLimited = await call('/password-reset/request', { method: 'POST', body: { email: 'third-reset@example.invalid' } });
assert.equal(resetIpLimited.status, 429, 'the sixth request from this IP within one hour must be throttled');

// Expired verification tokens must be rejected and must not activate the member.
const expiredRegistration = await call('/register', { method: 'POST', body: { username: 'expired_user', displayName: 'Expired Token', email: 'expired@example.com', password: 'Expired-Token-Password-123!' } });
assert.equal(expiredRegistration.status, 201);
const expiredTokenMatch = capturedEmail.htmlBody.match(/[?]verify=([A-Za-z0-9_-]{32,80})/);
assert.ok(expiredTokenMatch, 'second verification mail must contain a token');
const expiredMember = db.members.find((m) => m.email === 'expired@example.com');
const storedExpiredToken = db.tokens.find((t) => t.member_id === expiredMember.id);
assert.ok(storedExpiredToken, 'verification token must be stored');
storedExpiredToken.expires_at = new Date(Date.now() - 1000).toISOString();
const expiredVerify = await call('/verify-email', { method: 'POST', body: { token: expiredTokenMatch[1] } });
assert.equal(expiredVerify.status, 400, 'expired token must be rejected');
assert.equal(expiredMember.email_verified_at, null, 'expired token must not activate the member');
const login = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(login.status, 200); assert.equal((await login.json()).member.username, 'thanhvien_1');
const setCookie = login.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Path=\//); const cookie = setCookie.split(';')[0];
const me = await call('/me', { cookie }); assert.equal(me.status, 200); assert.equal((await me.json()).member.username, 'thanhvien_1');

// Full password-reset lifecycle: generic response, hashed one-time token, password update,
// expiry/replay rejection and revocation of existing sessions.
const resetRequest = await call('/password-reset/request', { method: 'POST', ip: '203.0.113.50', body: { email: 'member@example.com' } });
assert.equal(resetRequest.status, 200);
const resetGeneric = await resetRequest.json();
assert.equal(resetGeneric.ok, true);
assert.equal(capturedEmail.to, 'member@example.com');
const resetTokenMatch = capturedEmail.htmlBody.match(/[?]reset=([A-Za-z0-9_-]{32,80})/);
assert.ok(resetTokenMatch, 'password-reset email must contain a random token');
const rawResetToken = resetTokenMatch[1];
const storedResetToken = db.resetTokens.find((t) => t.member_id === db.members.find((m) => m.email === 'member@example.com').id);
assert.ok(storedResetToken, 'password-reset token hash must be stored');
assert.notEqual(storedResetToken.token_hash, rawResetToken, 'raw password-reset token must never be stored');
const nonexistentReset = await call('/password-reset/request', { method: 'POST', ip: '203.0.113.51', body: { email: 'not-a-member@example.com' } });
assert.equal(nonexistentReset.status, 200);
assert.deepEqual(await nonexistentReset.json(), resetGeneric, 'existing and nonexistent emails must receive the same public response');
const resetComplete = await call('/password-reset/complete', { method: 'POST', ip: '203.0.113.52', body: { token: rawResetToken, password: 'New-Strong-Password-456!' } });
assert.equal(resetComplete.status, 200);
assert.equal((await resetComplete.json()).ok, true);
assert.equal(db.resetTokens.length, 0, 'successful reset must consume the token');
assert.equal(db.sessions.some((s) => s.member_id === db.members.find((m) => m.email === 'member@example.com').id), false, 'successful reset must revoke all existing sessions');
const oldSessionAfterReset = await call('/me', { cookie });
assert.equal((await oldSessionAfterReset.json()).member, null, 'old session must no longer authenticate');
const oldPasswordAfterReset = await call('/login', { method: 'POST', ip: '203.0.113.53', body: { email: 'member@example.com', password: 'MotMatKhauRieng123!' } });
assert.equal(oldPasswordAfterReset.status, 401);
const newPasswordLogin = await call('/login', { method: 'POST', ip: '203.0.113.54', body: { email: 'member@example.com', password: 'New-Strong-Password-456!' } });
assert.equal(newPasswordLogin.status, 200);
const replayReset = await call('/password-reset/complete', { method: 'POST', ip: '203.0.113.55', body: { token: rawResetToken, password: 'Another-Strong-Password-789!' } });
assert.equal(replayReset.status, 400, 'password-reset token must be single-use');
const expiredResetRequest = await call('/password-reset/request', { method: 'POST', ip: '203.0.113.56', body: { email: 'member@example.com' } });
assert.equal(expiredResetRequest.status, 200);
const expiredResetToken = capturedEmail.htmlBody.match(/[?]reset=([A-Za-z0-9_-]{32,80})/)[1];
const expiredResetRow = db.resetTokens.find((t) => t.token_hash !== rawResetToken);
assert.ok(expiredResetRow);
expiredResetRow.expires_at = new Date(Date.now() - 1000).toISOString();
const expiredReset = await call('/password-reset/complete', { method: 'POST', ip: '203.0.113.57', body: { token: expiredResetToken, password: 'Expired-Strong-Password-789!' } });
assert.equal(expiredReset.status, 400, 'expired password-reset token must be rejected');

// The mail relay can reject a message despite HTTP 200; fail closed and remove the pending member/token.
relayResult = { ok: false, code: 'SEND_FAILED' };
const tokenCountBeforeFailedMail = db.tokens.length;
const failedMail = await call('/register', { method: 'POST', body: { username: 'mail_fail_user', displayName: 'Mail Failure', email: 'mail-failure@example.invalid', password: 'Another-Temporary-Password-123!' } });
assert.equal(failedMail.status, 503);
assert.equal(db.members.some((m) => m.email === 'mail-failure@example.invalid'), false, 'failed email delivery must not leave a pending member');
assert.equal(db.tokens.length, tokenCountBeforeFailedMail, 'failed email delivery must not leave an extra verification token');
relayResult = { ok: true };
const sent = await call('/messages', { method: 'POST', cookie, body: { topic: 'automation', body: 'Tôi đang thử một workflow có bước duyệt.' } }); assert.equal(sent.status, 201); assert.equal((await sent.json()).message.topic, 'automation');
const listed = await call('/messages?topic=automation', { cookie }); assert.equal(listed.status, 200); const listedPayload = await listed.json(); assert.equal(listedPayload.messages.length, 1); assert.equal(listedPayload.messages[0].own, true);
const removed = await call(`/messages/${listedPayload.messages[0].id}`, { method: 'DELETE', cookie }); assert.equal(removed.status, 200); assert.equal(db.messages.length, 0);
const badTopic = await call('/messages?topic=unknown', { cookie }); assert.equal(badTopic.status, 400);
const badMessage = await call('/messages', { method: 'POST', cookie, body: { topic: 'tools', body: '   ' } }); assert.equal(badMessage.status, 400);

const wrongPassword = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'sai-mat-khau' } }); assert.equal(wrongPassword.status, 401);
const logout = await call('/logout', { method: 'POST', cookie }); assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
globalThis.fetch = originalFetch;
console.log('PASS: email verification required before login; one-time token, Apps Script relay mock, PBKDF2 login, secure session, messages, validation, origin protection and missing-DB behavior');
