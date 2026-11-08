'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'data', 'ai-tools.json');
const raw = fs.readFileSync(sourcePath, 'utf8');
const catalog = JSON.parse(raw);

function validate(value) {
  assert.equal(value.schema_version, '1.0.0');
  assert.ok(Array.isArray(value.tools) && value.tools.length > 0, 'catalog must contain tools');
  const ids = value.tools.map((tool) => tool.id);
  assert.equal(new Set(ids).size, ids.length, 'catalog IDs must be unique');
  for (const tool of value.tools) {
    for (const key of ['id', 'name', 'vendor', 'website', 'description', 'pricing_model', 'pricing_status', 'license', 'verification_status', 'status']) {
      assert.equal(typeof tool[key], 'string', tool.id + ': missing ' + key);
      assert.ok(tool[key].trim(), tool.id + ': blank ' + key);
    }
    assert.ok(Array.isArray(tool.categories) && tool.categories.length, tool.id + ': categories required');
    assert.ok(Array.isArray(tool.platforms) && tool.platforms.length, tool.id + ': platforms required');
    assert.ok(Array.isArray(tool.official_sources) && tool.official_sources.length, tool.id + ': official sources required');
    for (const source of tool.official_sources) assert.match(source, /^https:\/\//, tool.id + ': source must be HTTPS');
  }
  return ids.length;
}

const count = validate(catalog);
assert.equal(count, 27, 'published catalog inventory must remain 27 entries');
assert.ok(catalog.tools.some((tool) => tool.id === 'flowise' && tool.status === 'deprecated'), 'deprecated status must be preserved');
assert.ok(catalog.tools.some((tool) => tool.id === 'n8n' && /sustainable/i.test(tool.license)), 'license caveats must be preserved');

const duplicate = structuredClone(catalog);
duplicate.tools.push({ ...duplicate.tools[0] });
assert.throws(() => validate(duplicate), /IDs must be unique/, 'duplicate IDs must fail');
const incomplete = structuredClone(catalog);
delete incomplete.tools[0].official_sources;
assert.throws(() => validate(incomplete), /official_sources/, 'missing source citations must fail');
assert.throws(() => JSON.parse(raw + '{'), SyntaxError, 'malformed JSON must fail');

console.log('AI CATALOG VALIDATION PASS: ' + count + ' entries; unique IDs, required metadata, HTTPS sources, license/status caveats, duplicate and malformed-data rejection.');
