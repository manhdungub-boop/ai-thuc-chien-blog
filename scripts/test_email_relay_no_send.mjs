#!/usr/bin/env node
'use strict';

const relayUrl = String(process.env.COMMUNITY_EMAIL_RELAY_URL || '');
const secret = String(process.env.COMMUNITY_EMAIL_RELAY_SECRET || '');
if (!relayUrl || !secret) {
  console.log('RELAY_NO_SEND_PROBE=skipped (relay repository secrets are not configured).');
  process.exit(0);
}
const endpoint = new URL(relayUrl);
if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'script.google.com' ||
    !/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname) || endpoint.search || endpoint.hash) {
  throw new Error('Relay URL must be an HTTPS Google Apps Script Web App URL ending in /exec.');
}
if (secret.length < 32) throw new Error('Relay shared secret must contain at least 32 characters.');

// A deliberately invalid message proves that the deployed relay recognizes the shared secret.
// Code.gs returns INVALID_MESSAGE before MailApp is called, so this probe must never send email.
const payload = {
  secret,
  to: '',
  subject: 'No-send relay connectivity probe',
  textBody: '',
  htmlBody: '',
  verifyUrl: 'https://invalid.example/?verify=short#cong-dong',
};
let response;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
} catch (error) {
  throw new Error(`Apps Script relay endpoint could not be reached (${String(error?.name || 'network error')}).`);
}
let body;
try { body = await response.json(); } catch (_) {
  throw new Error(`Apps Script relay returned a non-JSON response (HTTP ${response.status}). Check Web App deployment/access settings.`);
}
if (!response.ok || body.ok !== false || body.code !== 'INVALID_MESSAGE') {
  const code = typeof body.code === 'string' ? body.code : 'unknown';
  throw new Error(`Apps Script no-send probe did not return INVALID_MESSAGE (HTTP ${response.status}, code ${code}). No successful email delivery is claimed.`);
}
console.log('RELAY_NO_SEND_PROBE=success (Web App reachable; shared secret accepted; response INVALID_MESSAGE occurs before MailApp, no email sent).');
