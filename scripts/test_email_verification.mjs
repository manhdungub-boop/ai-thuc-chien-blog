#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const worker = fs.readFileSync(new URL('../worker.mjs', import.meta.url), 'utf8');
const frontend = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0002_email_verification.sql', import.meta.url), 'utf8');
assert.match(worker, /COMMUNITY_VERIFICATION_SECONDS = 30 \* 60/);
assert.match(worker, /COMMUNITY_EMAIL_RELAY_URL/);
assert.match(worker, /COMMUNITY_EMAIL_RELAY_SECRET/);
assert.match(worker, /result\?\.ok !== true/);
const relay = fs.readFileSync(new URL('../email-relay/Code.gs', import.meta.url), 'utf8');
assert.match(relay, /PropertiesService\.getScriptProperties/);
assert.match(relay, /MailApp\.sendEmail/);
assert.match(relay, /COMMUNITY_EMAIL_RELAY_SECRET/);
assert.match(relay, /getRemainingDailyQuota/);
assert.doesNotThrow(() => new Function(relay), 'Google Apps Script relay must parse as JavaScript');
assert.match(worker, /route === "verify-email"/);
assert.match(worker, /route === "resend-verification"/);
assert.ok(worker.includes('route === "password-reset/request"'));
assert.ok(worker.includes('route === "password-reset/complete"'));
assert.match(worker, /community_password_reset_tokens/);
assert.match(worker, /password-reset-email:/);
assert.match(worker, /DELETE FROM community_sessions WHERE member_id = \\?/);
assert.match(worker, /EMAIL_NOT_VERIFIED/);
assert.match(worker, /email_verified_at IS NOT NULL/);
assert.match(worker, /SHA-256/);
assert.match(worker, /DELETE FROM community_email_verification_tokens WHERE token_hash = \?/);
assert.match(frontend, /community-verify-confirm/);
assert.match(frontend, /community-resend-verification/);
assert.match(frontend, /community-forgot-password/);
assert.match(frontend, /community-password-reset-form/);
assert.ok(frontend.includes("password-reset/complete"));
assert.match(frontend, /verificationRequired/);
assert.ok(frontend.includes("const communityAuthHosts = new Set([\n    primaryHost,\n    'feature-required-email-verification-ai-thuc-chien-blog.manhdungub.workers.dev'\n  ]);"), 'isolated Preview must expose auth controls for end-to-end email testing');
assert.match(frontend, /if \(!communityAuthHosts\.has\(window\.location\.hostname\)\)/, 'unrecognized hosts must keep community auth controls hidden');
assert.match(html, /id="community-verify-confirm"/);
assert.match(html, /id="community-resend-verification"/);
assert.match(migration, /ALTER TABLE community_members ADD COLUMN email_verified_at TEXT/);
assert.match(migration, /UPDATE community_members SET email_verified_at = created_at/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS community_email_verification_tokens/);
assert.match(migration, /ON DELETE CASCADE/);
const resetMigration = fs.readFileSync(new URL('../migrations/0004_community_password_reset.sql', import.meta.url), 'utf8');
assert.match(resetMigration, /community_password_reset_tokens/);
assert.match(resetMigration, /token_hash TEXT PRIMARY KEY/);
assert.match(resetMigration, /ON DELETE CASCADE/);
assert.ok(relay.includes('(?:verify|reset)='), 'relay must accept password reset tokens only on allowlisted hosts');
console.log('PASS: email verification routes, fail-closed configuration, UI controls and additive migration are present.');


// Execute the actual Apps Script relay in a sandbox with mocked Google services.
const relayState = { secret: 'test-secret-that-is-at-least-32-characters', allowedHosts: 'ai-thuc-chien-blog.manhdungub.workers.dev,feature-required-email-verification-ai-thuc-chien-blog.manhdungub.workers.dev', remainingQuota: 10, sent: [] };
const relaySandbox = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === 'COMMUNITY_EMAIL_RELAY_SECRET' ? relayState.secret : (key === 'COMMUNITY_EMAIL_ALLOWED_HOSTS' ? relayState.allowedHosts : null) }) },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (content) => ({ content, setMimeType() { return this; } }) },
  MailApp: { getRemainingDailyQuota: () => relayState.remainingQuota, sendEmail: (message) => relayState.sent.push(message) },
};
vm.runInNewContext(relay, relaySandbox);
const relayPayload = {
  secret: relayState.secret,
  to: 'member@example.test',
  subject: 'Xác nhận email — AI Thực Chiến',
  displayName: 'Tester',
  verifyUrl: 'https://ai-thuc-chien-blog.manhdungub.workers.dev/?verify=abcdefghijklmnopqrstuvwxyz0123456789_AB-cd#cong-dong',
  textBody: 'Confirm your email',
  htmlBody: '<a href="https://ai-thuc-chien-blog.manhdungub.workers.dev/?verify=abcdefghijklmnopqrstuvwxyz0123456789_AB-cd#cong-dong">Confirm</a>',
};
const relayCall = (payload) => JSON.parse(relaySandbox.doPost({ postData: { contents: JSON.stringify(payload) } }).content);
assert.equal(relayCall({ ...relayPayload, secret: 'wrong-secret' }).code, 'UNAUTHORIZED');
assert.equal(relayState.sent.length, 0, 'invalid relay secret must never send email');
assert.equal(relayCall({ ...relayPayload, verifyUrl: 'https://evil.example/?verify=abcdefghijklmnopqrstuvwxyz0123456789_AB-cd' }).code, 'INVALID_MESSAGE');
assert.equal(relayState.sent.length, 0, 'unapproved verification host must never send email');
assert.deepEqual(relayCall(relayPayload), { ok: true });
assert.equal(relayState.sent.length, 1);
assert.equal(relayState.sent[0].to, 'member@example.test');
assert.equal(relayState.sent[0].htmlBody, relayPayload.htmlBody);
const resetUrlPayload = {
  ...relayPayload,
  subject: 'Đặt lại mật khẩu — AI Thực Chiến',
  verifyUrl: 'https://feature-required-email-verification-ai-thuc-chien-blog.manhdungub.workers.dev/?reset=abcdefghijklmnopqrstuvwxyz0123456789_AB-cd#cong-dong',
  textBody: 'Reset password',
  htmlBody: '<a href="https://feature-required-email-verification-ai-thuc-chien-blog.manhdungub.workers.dev/?reset=abcdefghijklmnopqrstuvwxyz0123456789_AB-cd#cong-dong">Reset</a>'
};
assert.deepEqual(relayCall(resetUrlPayload), { ok: true }, 'approved Preview password reset link should be accepted by the relay');
assert.equal(relayState.sent.length, 2);
const previewUrlPayload = { ...relayPayload, verifyUrl: 'https://feature-required-email-verification-ai-thuc-chien-blog.manhdungub.workers.dev/?verify=abcdefghijklmnopqrstuvwxyz0123456789_AB-cd#cong-dong' };
assert.deepEqual(relayCall(previewUrlPayload), { ok: true }, 'configured staging hostname should be allowed before production release');
assert.equal(relayState.sent.length, 3);
relayState.allowedHosts = 'ai-thuc-chien-blog.manhdungub.workers.dev';
assert.equal(relayCall(previewUrlPayload).code, 'INVALID_MESSAGE', 'preview hostname must be removed before production release');
assert.equal(relayState.sent.length, 3);
relayState.allowedHosts = 'ai-thuc-chien-blog.manhdungub.workers.dev,feature-required-email-verification-ai-thuc-chien-blog.manhdungub.workers.dev';
relayState.remainingQuota = 0;
assert.equal(relayCall(relayPayload).code, 'DAILY_QUOTA_EXHAUSTED');
assert.equal(relayState.sent.length, 3, 'exhausted quota must not send email');
console.log('PASS: Apps Script relay enforces secret, allowed verification origin, sender quota and safe send behavior.');
