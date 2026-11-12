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
assert.equal(calls.length, 2, 'Scheduled cleanup must issue two bounded D1 deletes');
assert.equal(calls[0].sql, 'DELETE FROM community_rate_limits WHERE window_start < ?');
assert.equal(calls[0].value, scheduledTime - (2 * 60 * 60 * 1000),
  'Rate-limit cleanup must retain a two-hour grace period beyond the maximum one-hour window');
assert.equal(calls[1].sql, 'DELETE FROM community_topic_presence WHERE last_seen_at < ?');
assert.equal(calls[1].value, new Date(scheduledTime - (120 * 1000)).toISOString(),
  'Presence cleanup must retain only the 120-second online window');

let fallbackCalls = [];
await worker.scheduled({}, { DB: { prepare(sql) {
  return {
    bind(value) {
      fallbackCalls.push({ sql, value });
      return this;
    },
    async run() {},
  };
} } });
assert.equal(fallbackCalls.length, 2, 'Missing scheduledTime must safely fall back to the current clock');
assert.equal(fallbackCalls[0].sql, 'DELETE FROM community_rate_limits WHERE window_start < ?');
assert.equal(fallbackCalls[1].sql, 'DELETE FROM community_topic_presence WHERE last_seen_at < ?');
assert.ok(fallbackCalls[0].value < Date.now());
assert.ok(Date.parse(fallbackCalls[1].value) < Date.now());
console.log('PASS: hourly cleanup bounds rate-limit retention and removes expired topic-presence rows after 120 seconds.');
