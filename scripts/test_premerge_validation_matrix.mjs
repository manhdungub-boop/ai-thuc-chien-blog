import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/premerge-validation.yml', 'utf8');

const requiredBranches = [
  ['docs-only', 'Validate documentation-only changes'],
  ['content-only', 'Validate static content-only changes'],
  ['content-only', 'Require exact-head Pages Preview for static content'],
  ['application-only', 'Validate application and Worker changes'],
  ['runtime-only', 'Validate Agent Runtime changes without deployment'],
  ['workflow-only', 'Validate workflow-only changes without deployment'],
  ['mixed-unknown', 'Fail-closed validation for mixed or unknown changes'],
];

test('every path class maps to its intended bounded validation step', () => {
  for (const [pathClass, stepName] of requiredBranches) {
    const step = workflow.split('- name: ' + stepName)[1];
    assert.ok(step, 'missing workflow step: ' + stepName);
    assert.ok(step.split('\\n')[1].includes("if: steps.scope.outputs.scope == '" + pathClass + "'"),
      stepName + ' must be conditional on ' + pathClass);
  }
});

test('content path class cannot pass without exact-head Preview success', () => {
  assert.match(workflow, /name: Require exact-head Pages Preview for static content/);
  assert.match(workflow, /item\\.get\\("head_sha"\\) == os\\.environ\\["HEAD_SHA"\\]/);
  assert.match(workflow, /matching\\[0\\]\\.get\\("conclusion"\\) == "success"/);
  assert.match(workflow, /failed or was skipped; refusing to pass aggregate validation/);
});

test('mixed and unknown paths have a strict fallback', () => {
  assert.match(workflow, /scope == 'mixed-unknown'/);
  assert.match(workflow, /Fail-closed validation for mixed or unknown changes/);
});
