#!/usr/bin/env node
'use strict';

import fs from 'node:fs';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_WORKERS_API_TOKEN;
if (!accountId || !token) {
  console.error('Missing Cloudflare account/token environment; live community schema check cannot run.');
  process.exit(2);
}

const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
const production = (config.d1_databases || []).find((item) => item.binding === 'DB');
const preview = ((config.previews || {}).d1_databases || []).find((item) => item.binding === 'DB');
if (!production || !preview) throw new Error('Production and preview DB bindings are both required.');
if (production.database_id === preview.database_id) throw new Error('Preview DB must not point at production.');

const required = {
  community_members: ['id', 'username', 'email', 'display_name', 'password_salt', 'password_hash', 'created_at'],
  community_sessions: ['id', 'member_id', 'token_hash', 'created_at', 'expires_at'],
  community_messages: ['id', 'topic', 'member_id', 'body', 'created_at'],
  community_rate_limits: ['bucket', 'count', 'window_start'],
};
const sql = "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 10) = 'community_' ORDER BY name";

async function inspect(label, database) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${database.database_id}/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`${label}: D1 schema query returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok || payload.success !== true) {
    const codes = (payload.errors || []).map((item) => item.code).filter(Boolean).join(', ');
    throw new Error(`${label}: read-only D1 schema query failed (HTTP ${response.status}${codes ? `, code ${codes}` : ''}). Check the GitHub Actions secret permissions.`);
  }
  const sets = Array.isArray(payload.result) ? payload.result : [payload.result];
  const rows = sets.flatMap((set) => Array.isArray(set?.results) ? set.results : []);
  const schema = new Map(rows.map((row) => [String(row.name), String(row.sql || '')]));
  const missingTables = [];
  const missingColumns = [];
  for (const [table, columns] of Object.entries(required)) {
    const definition = schema.get(table);
    if (!definition) { missingTables.push(table); continue; }
    const absent = columns.filter((column) => !new RegExp(`\\b${column}\\b`, 'i').test(definition));
    if (absent.length) missingColumns.push(`${table}: ${absent.join(', ')}`);
  }
  console.log(`${label} database: ${database.database_name} (${database.database_id})`);
  console.log(`Community tables present: ${[...schema.keys()].sort().join(', ') || '(none)'}`);
  if (missingTables.length) console.error(`Missing required tables: ${missingTables.join(', ')}`);
  if (missingColumns.length) console.error(`Missing required columns: ${missingColumns.join('; ')}`);
  if (missingTables.length || missingColumns.length) throw new Error(`${label}: community D1 schema is incomplete; registration/session/rate-limit operations may fail.`);
  console.log(`PASS: ${label} community D1 schema matches all tables and columns used by the Worker.`);
}

try {
  await inspect('production', production);
  await inspect('preview', preview);
  console.log('PASS: D1 diagnostic queried schema metadata only; it did not read or alter member/message rows.');
} catch (error) {
  console.error(`COMMUNITY_D1_SCHEMA_DIAGNOSTIC_FAILED: ${error.message}`);
  process.exitCode = 1;
}
