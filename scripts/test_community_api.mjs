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
  constructor() { this.members = []; this.sessions = []; this.messages = []; this.tokens = []; this.resetTokens = []; this.rates = new Map(); this.failBatchAfter = null; this.suppressPasswordUpdate = false; }
  async batch(statements) {
    const snapshot = { members: structuredClone(this.members), sessions: structuredClone(this.sessions), tokens: structuredClone(this.tokens), resetTokens: structuredClone(this.resetTokens) };
    try {
      const results = [];
      for (let index = 0; index < statements.length; index += 1) {
        results.push(await statements[index].run());
        if (this.failBatchAfter === index) throw new Error('Simulated D1 batch failure');
      }
      this.failBatchAfter = null;
      return results;
    } catch (error) {
      this.members = snapshot.members; this.sessions = snapshot.sessions; this.tokens = snapshot.tokens; this.resetTokens = snapshot.resetTokens;
      this.failBatchAfter = null;
      throw error;
    }
  }
  prepare(sql) {
    const db = this; let args = [];
    return {
      bind(...values) { args = values; return this; },
      async run() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('UPDATE community_members SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL')) { const [verifiedAt, id] = args; const member = db.members.find((m) => m.id === id && !m.email_verified_at); if (!member) return { meta: { changes: 0 } }; member.email_verified_at = verifiedAt; return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_email_verification_tokens WHERE token_hash = ? AND EXISTS')) { const [tokenHash, verifiedAt] = args; const token = db.tokens.find((t) => t.token_hash === tokenHash && db.members.some((m) => m.id === t.member_id && m.email_verified_at === verifiedAt)); if (!token) return { meta: { changes: 0 } }; db.tokens = db.tokens.filter((t) => t !== token); return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_email_verification_tokens WHERE member_id = ? AND EXISTS')) { const [memberId, guardId, verifiedAt] = args; if (!db.members.some((m) => m.id === memberId && m.id === guardId && m.email_verified_at === verifiedAt)) return { meta: { changes: 0 } }; const before = db.tokens.length; db.tokens = db.tokens.filter((t) => t.member_id !== memberId); return { meta: { changes: before - db.tokens.length } }; }
        if (q.startsWith('UPDATE community_members SET password_salt = ?, password_hash = ? WHERE id = (')) { const [salt, hash, tokenHash, now] = args; const token = db.resetTokens.find((t) => t.token_hash === tokenHash && t.expires_at > now); const member = token && db.members.find((m) => m.id === token.member_id && m.email_verified_at); if (db.suppressPasswordUpdate || !member) return { meta: { changes: 0 } }; member.password_salt = salt; member.password_hash = hash; return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE member_id = (SELECT t.member_id')) { const [tokenHash, now, salt, hash] = args; const token = db.resetTokens.find((t) => t.token_hash === tokenHash && t.expires_at > now); const member = token && db.members.find((m) => m.id === token.member_id && m.password_salt === salt && m.password_hash === hash); if (!member) return { meta: { changes: 0 } }; const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.member_id !== member.id); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('DELETE FROM community_password_reset_tokens WHERE token_hash = ? AND expires_at > ? AND EXISTS')) { const [tokenHash, now, salt, hash] = args; const token = db.resetTokens.find((t) => t.token_hash === tokenHash && t.expires_at > now); const member = token && db.members.find((m) => m.id === token.member_id && m.password_salt === salt && m.password_hash === hash); if (!member) return { meta: { changes: 0 } }; const before = db.resetTokens.length; db.resetTokens = db.resetTokens.filter((t) => t !== token); return { meta: { changes: before - db.resetTokens.length } }; }
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
let relayRedirectLocation = 'https://script.googleusercontent.com/macros/echo?user_content_key=test';
let omitRelayRedirectLocation = false;
globalThis.fetch = async (input, init = {}) => {
  if (String(input) === 'https://mail-relay.example.test/exec') {
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual', 'Apps Script POST must not automatically follow redirects.');
    capturedEmail = JSON.parse(init.body);
    assert.equal(capturedEmail.secret, 'test-shared-secret');
    return new Response(null, { status: 302, headers: omitRelayRedirectLocation ? {} : { Location: relayRedirectLocation } });
  }
  const destination = new URL(String(input));
  assert.equal(destination.origin, 'https://script.googleusercontent.com');
  assert.equal(init.method, 'GET', 'Apps Script response URL must be fetched with GET.');
  assert.equal(init.body, undefined, 'Never forward relay POST body or secret to the redirect URL.');
  assert.equal(init.headers, undefined, 'Never forward application headers to the redirect URL.');
  assert.equal(init.redirect, 'manual');
  return new Response(JSON.stringify(relayResult), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const call = (path, { method = 'GET', body, cookie, originHeader = origin, ip = '198.51.100.77' } = {}) => worker.fetch(new Request(`https://example.test/api/community${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(originHeader ? { Origin: originHeader } : {}), 'CF-Connecting-IP': ip }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
const unconfigured = await worker.fetch(new Request('https://example.test/api/community/me'), {}); assert.equal(unconfigured.status, 503); assert.match((await unconfigured.json()).error, /cơ sở dữ liệu/i);
const badOrigin = await call('/register', { method: 'POST', originHeader: 'https://evil.example', body: {} }); assert.equal(badOrigin.status, 403);
const previewOrigin = 'https://feature-required-email-verification-ai-thuc-chien-blog.workers.dev';
const previewSameOriginResponse = await worker.fetch(new Request(`${previewOrigin}/api/community/me`, { headers: { Origin: previewOrigin } }), env);
assert.equal(previewSameOriginResponse.status, 200, 'same-origin Preview API calls should be accepted');
assert.equal(previewSameOriginResponse.headers.get('Access-Control-Allow-Origin'), previewOrigin);

// Port the email-verification boundary checks from GitLab to the current Worker.
const communityPreflight = await call('/register', { method: 'OPTIONS' });
assert.equal(communityPreflight.status, 200, 'allowed community CORS preflight must succeed');
assert.equal(communityPreflight.headers.get('Access-Control-Allow-Origin'), origin);
assert.match(communityPreflight.headers.get('Access-Control-Allow-Methods') || '', /POST/);
assert.match(communityPreflight.headers.get('Cache-Control') || '', /no-store/);
const malformedVerification = await call('/verify-email', {
  method: 'POST',
  body: { token: 'not-a-valid-token' }
});
assert.equal(malformedVerification.status, 400, 'malformed email-verification tokens must be rejected');
assert.equal(malformedVerification.headers.get('Access-Control-Allow-Origin'), origin);
assert.equal(malformedVerification.headers.get('X-Content-Type-Options'), 'nosniff');

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

// The Apps Script 302 must be followed only to the exact Googleusercontent HTTPS origin.
const relayBoundaryCounts = [db.members.length, db.tokens.length];
relayRedirectLocation = 'https://script.googleusercontent.com:8443/macros/echo?user_content_key=unsafe';
const unsafePortRegistration = await call('/register', { method: 'POST', body: { username: 'unsafe_port_user', displayName: 'Unsafe Port', email: 'unsafe-port@example.invalid', password: 'Temporary-Unsafe-Port-Password-123!' } });
assert.equal(unsafePortRegistration.status, 503);
assert.deepEqual([db.members.length, db.tokens.length], relayBoundaryCounts, 'unsafe redirect port must not leave a pending member or token');
relayRedirectLocation = 'https://user:pass@script.googleusercontent.com/macros/echo?user_content_key=unsafe';
const credentialRegistration = await call('/register', { method: 'POST', body: { username: 'credential_user', displayName: 'Credential Redirect', email: 'credential-redirect@example.invalid', password: 'Temporary-Credential-Password-123!' } });
assert.equal(credentialRegistration.status, 503);
assert.deepEqual([db.members.length, db.tokens.length], relayBoundaryCounts, 'credential-bearing redirect must not leave a pending member or token');
relayRedirectLocation = 'https://script.googleusercontent.com/macros/echo?user_content_key=test';
omitRelayRedirectLocation = true;
const missingLocationRegistration = await call('/register', { method: 'POST', body: { username: 'missing_location_user', displayName: 'Missing Location', email: 'missing-location@example.invalid', password: 'Temporary-Missing-Location-Password-123!' } });
assert.equal(missingLocationRegistration.status, 503);
assert.deepEqual([db.members.length, db.tokens.length], relayBoundaryCounts, 'redirect without Location must not leave a pending member or token');
omitRelayRedirectLocation = false;

const registered = await call('/register', { method: 'POST', body: { username: 'thanhvien_1', displayName: 'Thành viên thử', email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(registered.status, 201);
const registeredPayload = await registered.json(); assert.equal(registeredPayload.verificationRequired, true); assert.equal(JSON.stringify(registeredPayload).includes('MotMatKhauRieng123!'), false); assert.equal(registered.headers.get('set-cookie'), null); assert.ok(capturedEmail); assert.equal(capturedEmail.to, 'member@example.com');
const loginBeforeVerification = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(loginBeforeVerification.status, 403); assert.equal((await loginBeforeVerification.json()).code, 'EMAIL_NOT_VERIFIED');
const tokenMatch = capturedEmail.htmlBody.match(/[?]verify=([A-Za-z0-9_-]{32,80})/); assert.ok(tokenMatch, 'verification email must contain a random one-time token');
const memberAwaitingVerification = db.members.find((m) => m.email === 'member@example.com');
const verificationTokenRow = db.tokens.find((t) => t.member_id === memberAwaitingVerification.id);
db.failBatchAfter = 0;
const failedVerificationBatch = await call('/verify-email', { method: 'POST', body: { token: tokenMatch[1] } });
assert.equal(failedVerificationBatch.status, 500, 'a failed verification D1 batch must fail closed');
assert.equal(memberAwaitingVerification.email_verified_at, null, 'failed verification batch must not activate the account');
assert.ok(db.tokens.some((t) => t.token_hash === verificationTokenRow.token_hash), 'failed verification batch must preserve the one-time token');
const verify = await call('/verify-email', { method: 'POST', body: { token: tokenMatch[1] } });
assert.equal(verify.status, 200);
assert.equal((await verify.json()).ok, true);
assert.equal(db.tokens.length, 0);
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
const setCookie = login.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Path=\//); let cookie = setCookie.split(';')[0];
const me = await call('/me', { cookie }); assert.equal(me.status, 200); assert.equal((await me.json()).member.username, 'thanhvien_1');

// Regression coverage runs against the real Worker handler with an isolated in-memory D1 double.
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
const malformedResetToken = await call('/password-reset/complete', {
  method: 'POST', ip: '203.0.113.52',
  body: { token: 'bad', password: 'New-Strong-Password-456!' }
});
assert.equal(malformedResetToken.status, 400, 'malformed password-reset tokens must be rejected without consuming the valid token');
const shortResetPassword = await call('/password-reset/complete', {
  method: 'POST', ip: '203.0.113.52',
  body: { token: rawResetToken, password: 'short' }
});
assert.equal(shortResetPassword.status, 400, 'short replacement passwords must be rejected without consuming the valid token');
// A D1 batch failure after the password write must roll back the password, preserve the token, and keep sessions active.
const memberForAtomicReset = db.members.find((m) => m.email === 'member@example.com');
const originalPasswordHash = memberForAtomicReset.password_hash;
const sessionsBeforeAtomicReset = db.sessions.filter((s) => s.member_id === memberForAtomicReset.id).length;
db.failBatchAfter = 0;
const failedResetBatch = await call('/password-reset/complete', { method: 'POST', ip: '203.0.113.59', body: { token: rawResetToken, password: 'New-Strong-Password-456!' } });
assert.equal(failedResetBatch.status, 500, 'a D1 batch failure must fail the reset request');
assert.equal(memberForAtomicReset.password_hash, originalPasswordHash, 'failed batch must roll back password changes');
assert.ok(db.resetTokens.some((t) => t.token_hash === storedResetToken.token_hash), 'failed batch must preserve the reset token');
assert.equal(db.sessions.filter((s) => s.member_id === memberForAtomicReset.id).length, sessionsBeforeAtomicReset, 'failed batch must preserve existing sessions');

// A zero-row password update must not consume the token or revoke sessions.
db.suppressPasswordUpdate = true;
const zeroRowReset = await call('/password-reset/complete', { method: 'POST', ip: '203.0.113.60', body: { token: rawResetToken, password: 'New-Strong-Password-456!' } });
assert.equal(zeroRowReset.status, 400);
assert.ok(db.resetTokens.some((t) => t.token_hash === storedResetToken.token_hash), 'zero-row password update must preserve the reset token');
assert.equal(db.sessions.filter((s) => s.member_id === memberForAtomicReset.id).length, sessionsBeforeAtomicReset, 'zero-row password update must not revoke sessions');
db.suppressPasswordUpdate = false;

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
cookie = newPasswordLogin.headers.get('set-cookie').split(';')[0];
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

// Ported edge cases from GitLab's password-reset suite, adapted to the current GitHub Worker routes.
db.rates.clear();
relayResult = { ok: false, code: 'SEND_FAILED' };
const resetMemberId = db.members.find(member => member.email === 'member@example.com').id;
const resetRelayFailure = await call('/password-reset/request', {
  method: 'POST',
  ip: '203.0.113.58',
  body: { email: 'member@example.com' }
});
assert.equal(resetRelayFailure.status, 200, 'reset relay failure must preserve the generic public response');
assert.deepEqual(await resetRelayFailure.json(), resetGeneric);
assert.equal(db.resetTokens.some(token => token.member_id === resetMemberId), false,
  'failed reset email delivery must remove every reset token for the affected member');
relayResult = { ok: true };

// Atomic token consumption: concurrent submissions must yield exactly one success.
db.rates.clear();
const concurrentResetRequest = await call('/password-reset/request', {
  method: 'POST',
  ip: '203.0.113.59',
  body: { email: 'member@example.com' }
});
assert.equal(concurrentResetRequest.status, 200);
const concurrentTokenMatch = capturedEmail.htmlBody.match(/[?]reset=([A-Za-z0-9_-]{32,80})/);
assert.ok(concurrentTokenMatch, 'concurrent-reset fixture must contain a valid token');
const concurrentToken = concurrentTokenMatch[1];
const concurrentResponses = await Promise.all([
  call('/password-reset/complete', {
    method: 'POST', ip: '203.0.113.60',
    body: { token: concurrentToken, password: 'New-Concurrent-Password-123!' }
  }),
  call('/password-reset/complete', {
    method: 'POST', ip: '203.0.113.61',
    body: { token: concurrentToken, password: 'New-Concurrent-Password-456!' }
  })
]);
const concurrentStatuses = concurrentResponses.map(response => response.status).sort((a, b) => a - b);
assert.deepEqual(concurrentStatuses, [200, 400],
  'atomic reset-token consumption must allow only one concurrent request to succeed');
assert.equal(db.resetTokens.length, 0, 'concurrent reset must consume the token exactly once');
assert.equal(db.sessions.some(session => session.member_id === db.members.find(member => member.email === 'member@example.com').id),
  false, 'concurrent reset success must revoke all existing sessions');
const concurrentLoginAttempts = await Promise.all([
  call('/login', {
    method: 'POST', ip: '203.0.113.62',
    body: { email: 'member@example.com', password: 'New-Concurrent-Password-123!' }
  }),
  call('/login', {
    method: 'POST', ip: '203.0.113.64',
    body: { email: 'member@example.com', password: 'New-Concurrent-Password-456!' }
  })
]);
assert.deepEqual(concurrentLoginAttempts.map(response => response.status).sort((a, b) => a - b), [200, 401],
  'exactly the password from the single successful concurrent reset must authenticate');
const winningLogin = concurrentLoginAttempts.find(response => response.status === 200);
cookie = winningLogin.headers.get('set-cookie').split(';')[0];

// The completion endpoint must throttle repeated attempts even when tokens are well-formed but unknown.
db.rates.clear();
const invalidResetAttempts = [];
for (let attempt = 0; attempt < 11; attempt += 1) {
  invalidResetAttempts.push(await call('/password-reset/complete', {
    method: 'POST',
    ip: '203.0.113.63',
    body: { token: 'A'.repeat(43), password: 'Valid-New-Password-456!' }
  }));
}
const invalidResetStatuses = invalidResetAttempts.map(response => response.status);
assert.equal(invalidResetStatuses.filter(status => status === 400).length, 10,
  'the first ten well-formed invalid-token attempts must be rejected as invalid');
assert.equal(invalidResetStatuses[10], 429,
  'the eleventh password-reset completion attempt from one IP must be rate-limited');

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
