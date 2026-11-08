#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const relayUrl = 'https://relay.example.invalid/exec';
const relaySecret = 'test-secret-that-must-never-be-returned';
async function readJson(response) {
  const raw = await response.text();
  assert.doesNotMatch(raw, /test-secret-that-must-never-be-returned|relay\\.example|private database diagnostic/);
  return JSON.parse(raw);
}
const readyEnv = {
  COMMUNITY_EMAIL_RELAY_URL: relayUrl,
  COMMUNITY_EMAIL_RELAY_SECRET: relaySecret,
  DB: { prepare(sql) {
    assert.equal(sql, 'SELECT 1 AS ok', 'health check must use a read-only query');
    return { first: async () => ({ ok: 1 }) };
  } },
};

const ready = await worker.fetch(new Request('https://preview.example/health'), readyEnv);
assert.equal(ready.status, 200);
assert.deepEqual(await readJson(ready), {
  ok: true,
  checks: { database: 'ready', emailRelayConfigured: true },
});
assert.equal(ready.headers.get('cache-control'), 'no-store');
assert.equal(ready.headers.get('x-content-type-options'), 'nosniff');

const missingDatabase = await worker.fetch(new Request('https://preview.example/health'), {
  COMMUNITY_EMAIL_RELAY_URL: relayUrl,
  COMMUNITY_EMAIL_RELAY_SECRET: relaySecret,
});
assert.equal(missingDatabase.status, 503);
assert.deepEqual(await readJson(missingDatabase), {
  ok: false,
  checks: { database: 'unavailable', emailRelayConfigured: true },
});

const databaseFailure = await worker.fetch(new Request('https://preview.example/health'), {
  ...readyEnv,
  DB: { prepare(sql) {
    assert.equal(sql, 'SELECT 1 AS ok');
    return { first: async () => { throw new Error('private database diagnostic'); } };
  } },
});
assert.equal(databaseFailure.status, 503);
assert.deepEqual(await readJson(databaseFailure), {
  ok: false,
  checks: { database: 'unavailable', emailRelayConfigured: true },
});

const missingRelay = await worker.fetch(new Request('https://preview.example/health'), {
  DB: readyEnv.DB,
  COMMUNITY_EMAIL_RELAY_URL: relayUrl,
});
assert.equal(missingRelay.status, 503);
assert.deepEqual(await readJson(missingRelay), {
  ok: false,
  checks: { database: 'ready', emailRelayConfigured: false },
});

const malformedDatabaseResult = await worker.fetch(new Request('https://preview.example/health'), {
  ...readyEnv,
  DB: { prepare: () => ({ first: async () => ({ ok: 0 }) }) },
});
assert.equal(malformedDatabaseResult.status, 503);
assert.deepEqual(await readJson(malformedDatabaseResult), {
  ok: false,
  checks: { database: 'unavailable', emailRelayConfigured: true },
});

const unsupportedMethod = await worker.fetch(new Request('https://preview.example/health', { method: 'POST' }), readyEnv);
assert.equal(unsupportedMethod.status, 405);
assert.equal(unsupportedMethod.headers.get('allow'), 'GET, HEAD');
assert.equal(await unsupportedMethod.text().then((value) => JSON.parse(value).error), 'Method not allowed.');

const head = await worker.fetch(new Request('https://preview.example/health', { method: 'HEAD' }), readyEnv);
assert.equal(head.status, 200);
assert.equal(await head.text(), '');

console.log('PASS: health endpoint simulations — ready, missing D1, D1 error, missing relay secret, malformed D1 result, method rejection, HEAD, no secret leakage');
