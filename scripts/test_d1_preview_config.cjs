#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
const production = (config.d1_databases || []).filter(x => x.binding === 'DB');
const previews = ((config.previews || {}).d1_databases || []).filter(x => x.binding === 'DB');
assert.equal(production.length, 1, 'exactly one production DB binding named DB is required');
assert.equal(previews.length, 1, 'exactly one preview DB override named DB is required');
const prod = production[0];
const preview = previews[0];
assert.equal(prod.database_name, 'ai-thuc-chien-community', 'production database name changed unexpectedly');
assert.equal(preview.database_name, 'ai-thuc-chien-community-preview', 'preview database must be explicitly named as non-production');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
assert.match(prod.database_id || '', uuid, 'production D1 ID must be a UUID');
assert.match(preview.database_id || '', uuid, 'preview D1 ID must be a UUID');
assert.notEqual(prod.database_id, preview.database_id, 'preview D1 must never point to the production database');
assert.notEqual(prod.database_name, preview.database_name, 'preview D1 must never reuse the production database name');
console.log('PASS: Wrangler production and preview D1 bindings are distinct and structurally valid.');
