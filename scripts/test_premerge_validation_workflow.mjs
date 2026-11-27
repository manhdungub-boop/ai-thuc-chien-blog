import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/premerge-validation.yml', 'utf8');

test('pre-merge validation is PR-only, read-only, and non-deploying', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /^\\s+(?:pull_request_target|workflow_dispatch|schedule):/m);
  assert.doesNotMatch(workflow, /environment:|secrets\./);
  assert.doesNotMatch(workflow, /wrangler[^\n]*deploy|cloudflare[^\n]*deploy/i);
  assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /Fail-closed validation for mixed or unknown changes/);
});
