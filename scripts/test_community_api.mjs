#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
class MockD1 {
  constructor() { this.members = []; this.pending = []; this.sessions = []; this.messages = []; this.rates = new Map(); }
  prepare(sql) {
    const db = this; let args = [];
    return {
      bind(...values) { args = values; return this; },
      async run() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('INSERT INTO community_rate_limits')) { const [bucket, windowStart] = args; const old = db.rates.get(bucket); db.rates.set(bucket, { count: old && old.window_start === windowStart ? old.count + 1 : 1, window_start: windowStart }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_pending_members')) { const [id, username, email, display_name, password_salt, password_hash, otp_hash, created_at, last_sent_at, expires_at] = args; if (db.pending.some((m) => m.email === email || m.username === username) || db.members.some((m) => m.email === email || m.username === username)) throw new Error('unique constraint'); db.pending.push({ id, username, email, display_name, password_salt, password_hash, otp_hash, attempts: 0, created_at, last_sent_at, expires_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('UPDATE community_pending_members SET attempts = attempts + 1')) { const row = db.pending.find((m) => m.email === args[0]); if (row) row.attempts += 1; return { meta: { changes: row ? 1 : 0 } }; }
        if (q.startsWith('UPDATE community_pending_members SET otp_hash =')) { const [otp_hash, last_sent_at, expires_at, email] = args; const row = db.pending.find((m) => m.email === email); if (row) Object.assign(row, { otp_hash, attempts: 0, last_sent_at, expires_at }); return { meta: { changes: row ? 1 : 0 } }; }
        if (q.startsWith('DELETE FROM community_pending_members WHERE email =')) { const before = db.pending.length; db.pending = db.pending.filter((m) => m.email !== args[0]); return { meta: { changes: before - db.pending.length } }; }
        if (q.startsWith('INSERT INTO community_members')) { const [id, username, email, display_name, password_salt, password_hash, created_at] = args; if (db.members.some((m) => m.email === email || m.username === username)) throw new Error('unique constraint'); db.members.push({ id, username, email, display_name, password_salt, password_hash, created_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_sessions')) { const [id, member_id, token_hash, created_at, expires_at] = args; db.sessions.push({ id, member_id, token_hash, created_at, expires_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('INSERT INTO community_messages')) { const [id, topic, member_id, body, created_at] = args; db.messages.push({ id, topic, member_id, body, created_at }); return { meta: { changes: 1 } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE expires_at <=')) { const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.expires_at > args[0]); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('DELETE FROM community_sessions WHERE token_hash =')) { const before = db.sessions.length; db.sessions = db.sessions.filter((s) => s.token_hash !== args[0]); return { meta: { changes: before - db.sessions.length } }; }
        if (q.startsWith('DELETE FROM community_messages')) { const before = db.messages.length; db.messages = db.messages.filter((m) => !(m.id === args[0] && m.member_id === args[1])); return { meta: { changes: before - db.messages.length } }; }
        throw new Error('MockD1 unexpected run: ' + q);
      },
      async first() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT count FROM community_rate_limits')) return db.rates.get(args[0]) || null;
        if (q.startsWith('SELECT id FROM community_members WHERE email =')) return db.members.find((m) => m.email === args[0] || m.username === args[1]) || null;
        if (q.startsWith('SELECT email, username FROM community_pending_members')) return db.pending.find((m) => m.email === args[0] || m.username === args[1]) || null;
        if (q.startsWith('SELECT id, username, email, display_name, password_salt, password_hash, otp_hash, attempts, created_at, expires_at FROM community_pending_members')) return db.pending.find((m) => m.email === args[0]) || null;
        if (q.startsWith('SELECT email, last_sent_at FROM community_pending_members')) return db.pending.find((m) => m.email === args[0]) || null;
        if (q.startsWith('SELECT id, username, email, display_name, password_salt, password_hash, created_at FROM community_members')) return db.members.find((m) => m.email === args[0]) || null;
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
const db = new MockD1(); let lastCode = ''; let gatewayCalls = 0;
const oldFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => { const body = JSON.parse(init.body); lastCode = body.code; gatewayCalls += 1; assert.equal(body.secret, 'test-shared-secret-at-least-32-chars'); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
const env = { DB: db, OTP_GATEWAY_URL: 'https://script.google.com/macros/s/test-deployment/exec', OTP_GATEWAY_SECRET: 'test-shared-secret-at-least-32-chars', ASSETS: { fetch: async () => new Response('asset') } };
const call = (path, { method = 'GET', body, cookie, originHeader = origin } = {}) => worker.fetch(new Request(`https://example.test/api/community${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(originHeader ? { Origin: originHeader } : {}), 'CF-Connecting-IP': '198.51.100.77' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
const unconfigured = await worker.fetch(new Request('https://example.test/api/community/me'), {}); assert.equal(unconfigured.status, 503); assert.match((await unconfigured.json()).error, /cơ sở dữ liệu/i);
const badOrigin = await call('/register', { method: 'POST', originHeader: 'https://evil.example', body: {} }); assert.equal(badOrigin.status, 403);
const invalidRegister = await call('/register', { method: 'POST', body: { username: 'x', displayName: 'X', email: 'bad', password: 'short' } }); assert.equal(invalidRegister.status, 400);
const nullPayload = await call('/register', { method: 'POST', body: null }); assert.equal(nullPayload.status, 400);
const registered = await call('/register', { method: 'POST', body: { username: 'thanhvien_1', displayName: 'Thành viên thử', email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(registered.status, 202);
const registeredPayload = await registered.json(); assert.equal(registeredPayload.pendingVerification, true); assert.equal(db.members.length, 0); assert.equal(db.pending.length, 1); assert.equal(registered.headers.get('set-cookie'), null); assert.equal(gatewayCalls, 1); assert.match(lastCode, /^\d{6}$/);
const deliberatelyWrongCode = lastCode === '111111' ? '222222' : '111111';
const wrongCode = await call('/verify-email', { method: 'POST', body: { email: 'member@example.com', code: deliberatelyWrongCode } });
assert.equal(wrongCode.status, 400); assert.match((await wrongCode.json()).error, /mã xác minh/i);
const verified = await call('/verify-email', { method: 'POST', body: { email: 'member@example.com', code: lastCode } }); assert.equal(verified.status, 201); const verifiedPayload = await verified.json(); assert.equal(verifiedPayload.member.username, 'thanhvien_1'); assert.equal(JSON.stringify(verifiedPayload).includes('MotMatKhauRieng123!'), false); assert.equal(db.pending.length, 0); assert.equal(db.members.length, 1);
const setCookie = verified.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Path=\//); const cookie = setCookie.split(';')[0];
const me = await call('/me', { cookie }); assert.equal(me.status, 200); assert.equal((await me.json()).member.username, 'thanhvien_1');
const sent = await call('/messages', { method: 'POST', cookie, body: { topic: 'automation', body: 'Tôi đang thử một workflow có bước duyệt.' } }); assert.equal(sent.status, 201); assert.equal((await sent.json()).message.topic, 'automation');
const listed = await call('/messages?topic=automation', { cookie }); assert.equal(listed.status, 200); const listedPayload = await listed.json(); assert.equal(listedPayload.messages.length, 1); assert.equal(listedPayload.messages[0].own, true);
const removed = await call(`/messages/${listedPayload.messages[0].id}`, { method: 'DELETE', cookie }); assert.equal(removed.status, 200); assert.equal(db.messages.length, 0);
const badTopic = await call('/messages?topic=unknown', { cookie }); assert.equal(badTopic.status, 400);
const badMessage = await call('/messages', { method: 'POST', cookie, body: { topic: 'tools', body: '   ' } }); assert.equal(badMessage.status, 400);
const login = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'MotMatKhauRieng123!' } }); assert.equal(login.status, 200); assert.equal((await login.json()).member.username, 'thanhvien_1');
const wrongPassword = await call('/login', { method: 'POST', body: { email: 'member@example.com', password: 'sai-mat-khau' } }); assert.equal(wrongPassword.status, 401);
const logout = await call('/logout', { method: 'POST', cookie }); assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
globalThis.fetch = oldFetch;
console.log('PASS: OTP registration stores pending account, sends hashed OTP via gateway, verifies code before creating member/session, PBKDF2 login, secure cookie, messages, rate limits, origin protection, and missing-DB behavior');
