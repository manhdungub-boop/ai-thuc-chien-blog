import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChangedPaths } from './premerge-path-classifier.mjs';

test('classifies documentation-only changes', () => {
  assert.equal(classifyChangedPaths(['README.md', 'docs/operations.md']), 'docs-only');
});

test('classifies static content-only changes', () => {
  assert.equal(classifyChangedPaths(['articles/example.html', 'thu-vien.html', 'data/ai-tools.json']), 'content-only');
});

test('classifies application and runtime changes separately', () => {
  assert.equal(classifyChangedPaths(['worker.mjs', 'scripts/test_worker_headers.mjs']), 'application-only');
  assert.equal(classifyChangedPaths(['script.js']), 'application-only');
  assert.equal(classifyChangedPaths(['styles.css', 'images/hero.webp']), 'application-only');
  assert.equal(classifyChangedPaths(['tests/agent-runtime-contract.test.mjs']), 'runtime-only');
  assert.equal(classifyChangedPaths(['agents/runtime/src/index.mjs']), 'runtime-only');
});

test('classifies workflow-only changes', () => {
  assert.equal(classifyChangedPaths(['.github/workflows/premerge-validation.yml']), 'workflow-only');
});

test('fails closed for mixed, unknown, empty, and ambiguous paths', () => {
  assert.equal(classifyChangedPaths(['README.md', 'worker.mjs']), 'mixed-unknown');
  assert.equal(classifyChangedPaths(['unclassified/binary.dat']), 'mixed-unknown');
  assert.equal(classifyChangedPaths([]), 'mixed-unknown');
  assert.equal(classifyChangedPaths(['.github/workflows/ci.yml', 'worker.mjs']), 'mixed-unknown');
});
