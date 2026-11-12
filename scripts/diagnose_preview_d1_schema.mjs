#!/usr/bin/env node
'use strict';
import fs from 'node:fs';

const EXPECTED_ACCOUNT_ID = '92cf091bbac8b4879ec65feb30b4715b';
const EXPECTED_PRODUCTION_D1_ID = 'fc2517cb-9543-4d7b-98f4-bcd5f3c013e7';
const PREVIEW_D1_ID = '51d814c8-a3fc-4481-a5f1-60bc67617f3c';
const token = String(process.env.CLOUDFLARE_WORKERS_BUILDS_API_TOKEN || '');
if (!token) {
  console.log('PREVIEW_D1_SCHEMA_CHECK=unavailable (scoped Cloudflare token secret missing)');
  process.exit(0);
}
const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const production = (config.d1_databases || []).find((item) => item.binding === 'DB');
const preview = (((config.previews || {}).d1_databases) || []).find((item) => item.binding === 'DB');
if (
  config.account_id !== EXPECTED_ACCOUNT_ID ||
  production?.database_id !== EXPECTED_PRODUCTION_D1_ID ||
  preview?.database_id !== PREVIEW_D1_ID
) {
  throw new Error('Safety stop: Cloudflare account and D1 IDs do not match the reviewed immutable allowlist.');
}
const endpoint = 'https://api.cloudflare.com/client/v4/accounts/92cf091bbac8b4879ec65feb30b4715b/d1/database/51d814c8-a3fc-4481-a5f1-60bc67617f3c/query';
async function query(sql) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success !== true) {
    const codes = Array.isArray(body.errors) ? body.errors.map((item) => item.code).filter(Boolean).join(',') : '';
    return { available: false, status: response.status, codes };
  }
  const results = (body.result || []).flatMap((part) => part.results || []);
  return { available: true, results };
}
try {
  const columns = await query("PRAGMA table_info('community_members')");
  const tokenTable = await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'community_email_verification_tokens' LIMIT 1");
  if (!columns.available || !tokenTable.available) {
    console.log('PREVIEW_D1_SCHEMA_CHECK=unavailable http=' + (columns.status || tokenTable.status || 'unknown') + ' error_codes=' + (columns.codes || tokenTable.codes || 'unknown') + ' (read-only token may lack D1 permission)');
    process.exit(0);
  }
  const verifiedColumn = columns.results.some((row) => row.name === 'email_verified_at');
  const tokenTablePresent = tokenTable.results.length === 1;
  console.log('PREVIEW_D1_SCHEMA_CHECK database=preview email_verified_at=' + verifiedColumn + ' verification_tokens_table=' + tokenTablePresent);
} catch (error) {
  console.log('PREVIEW_D1_SCHEMA_CHECK=unavailable network_error=' + String(error?.name || 'Error'));
}
