#!/usr/bin/env node
'use strict';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const scheduledTime = Date.UTC(2026, 10, 13, 12, 17, 0);
const calls = [];
const db = {
  prepare(sql) {
    return {
      bind(value) {
        calls.push({ sql: sql.trim(), value });
        return this;
      },
      async run() { return { meta: { changes: 4 } }; },
    };
  },
};

await worker.scheduled({ scheduledTime }, { DB: db });
assert.equal(calls.length, 1, 'Scheduled cleanup must issue exactly one bounded D1 delete');
assert.equal(calls[0].sql, 'DELETE FROM community_rate_limits WHERE window_start < ?');
assert.equal(calls[0].value, scheduledTime - (2 * 60 * 60 * 1000),
  'Cleanup must retain a two-hour grace period beyond the maximum one-hour rate-limit window');

let fallbackCalls = 0;
await worker.scheduled({}, { DB: { prepare(sql) {
  return {
    bind(value) {
      fallbackCalls += 1;
      assert.equal(sql, 'DELETE FROM community_rate_limits WHERE window_start < ?');
      assert.ok(value < Date.now());
      return this;
    },
    async run() {},
  };
} } });
assert.equal(fallbackCalls, 1, 'Missing scheduledTime must safely fall back to the current clock');
console.log('PASS: hourly rate-limit cleanup uses a two-hour retention cutoff and only deletes expired buckets.');
