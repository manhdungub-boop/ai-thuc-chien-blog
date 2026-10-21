#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const workerUrl = String(process.env.PREVIEW_WORKER_URL || '').trim().replace(/\/+$/, '');
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_WORKERS_API_TOKEN || '').trim();
if (!workerUrl || !accountId || !token) throw new Error('Missing preview URL or Cloudflare environment.');
const target = new URL(workerUrl);
if (target.protocol !== 'https:' || !target.hostname.endsWith('-ai-thuc-chien-blog.workers.dev') || target.hostname === 'ai-thuc-chien-blog.manhdungub.workers.dev') {
  throw new Error('Safety stop: the test URL must be an isolated Cloudflare Workers preview host, not production.');
}
const wrangler = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
const production = (wrangler.d1_databases || []).find((item) => item.binding === 'DB');
const preview = ((wrangler.previews || {}).d1_databases || []).find((item) => item.binding === 'DB');
if (!production || !preview || preview.database_name !== 'ai-thuc-chien-community-preview' || preview.database_id === production.database_id) {
  throw new Error('Safety stop: preview D1 is not a distinct, explicitly named preview database.');
}

const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
const email = `diag-${suffix}@example.invalid`;
const payload = {
  username: `diag_${suffix}`,
  displayName: 'Temporary registration check',
  email,
  password: `Temp-${randomUUID()}-K9!`,
};
const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${preview.database_id}/query`;
async function d1Query(sql, params) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error(`Preview D1 cleanup returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok || result.success !== true) {
    const codes = (result.errors || []).map((entry) => entry.code).filter(Boolean).join(', ');
    throw new Error(`Preview D1 cleanup query failed (HTTP ${response.status}${codes ? `, code ${codes}` : ''}).`);
  }
  return result;
}

let registerStatus = 0;
let returnedCode = 'none';
let created = false;
let cleanupError = null;
try {
  const response = await fetch(`${workerUrl}/api/community/register`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://ai-thuc-chien-blog.manhdungub.workers.dev',
      Referer: 'https://ai-thuc-chien-blog.manhdungub.workers.dev/',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify(payload),
    redirect: 'error',
  });
  registerStatus = response.status;
  let body = {};
  try { body = await response.json(); } catch { /* Do not dump an HTML/security page into logs. */ }
  returnedCode = typeof body.code === 'string' ? body.code : 'none';
  created = response.status === 201 && Boolean(body.member?.id);
  console.log(`PREVIEW_REGISTRATION_HTTP_STATUS=${registerStatus}`);
  console.log(`PREVIEW_REGISTRATION_ERROR_CODE=${returnedCode}`);
  console.log(`PREVIEW_REGISTRATION_CREATED=${created ? 'yes' : 'no'}`);
  // Intentionally never log request payload, email, password, cookie, or member identifiers.
} finally {
  try {
    // Idempotently clean only the generated .invalid diagnostic identity from the preview database.
    await d1Query('DELETE FROM community_sessions WHERE member_id IN (SELECT id FROM community_members WHERE email = ?)', [email]);
    await d1Query('DELETE FROM community_members WHERE email = ?', [email]);
    console.log('PREVIEW_REGISTRATION_CLEANUP=complete');
  } catch (error) {
    cleanupError = error;
    console.error(`PREVIEW_REGISTRATION_CLEANUP=failed (${String(error?.message || error).slice(0, 180)})`);
  }
}
if (cleanupError) throw cleanupError;
if (registerStatus !== 201 || !created) throw new Error(`Preview registration did not succeed (HTTP ${registerStatus}, code ${returnedCode}); diagnostic identity was cleaned up.`);
console.log('PASS: actual Worker preview registration completed and the temporary identity was removed from the preview D1 database.');
