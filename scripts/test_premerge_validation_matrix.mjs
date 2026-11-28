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
    const expectedCondition = "if: steps.scope.outputs.scope == '" + pathClass + "'";
    assert.ok(step.slice(0, 180).includes(expectedCondition),
      stepName + ' must be conditional on ' + pathClass);
  }
});

test('content path class cannot pass without exact-head Preview success', () => {
  assert.ok(workflow.includes('name: Require exact-head Pages Preview for static content'));
  assert.ok(workflow.includes('item.get("head_sha") == os.environ["HEAD_SHA"]'));
  assert.ok(workflow.includes('matching[0].get("conclusion") == "success"'));
  assert.ok(workflow.includes('failed or was skipped; refusing to pass aggregate validation'));
});

test('mixed and unknown paths have a strict fallback', () => {
  assert.ok(workflow.includes("scope == 'mixed-unknown'"));
  assert.ok(workflow.includes('Fail-closed validation for mixed or unknown changes'));
});
