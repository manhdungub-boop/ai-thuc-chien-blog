import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = (name) => readFileSync(new URL('../.github/workflows/' + name, import.meta.url), 'utf8');
const jobGuard = (text, job) => new RegExp(
  '^  ' + job + ':\n    if: github\.ref == ['"]refs/heads/main['"]$',
  'm',
).test(text);

for (const [file, job] of [
  ['configure-cloudflare-worker-builds.yml', 'configure-triggers'],
  ['diagnose-cloudflare-worker-build.yml', 'diagnose'],
  ['diagnose-community-d1.yml', 'inspect'],
  ['repair-cloudflare-branch-preview-triggers.yml', 'repair-preview-only'],
  ['verify-cloudflare-deploy-token.yml', 'verify'],
  ['migrate-preview-d1.yml', 'preview-d1'],
]) {
  assert.ok(jobGuard(workflow(file), job), file + ': ' + job + ' must run only from refs/heads/main');
}

const health = workflow('health-check.yml');
const guarded = /^        if: \(github\.event_name == 'workflow_run' \|\| github\.event_name == 'workflow_dispatch'\) && github\.ref == 'refs\/heads\/main'$/gm;
const guardedSecretSteps = health.match(guarded) ?? [];
assert.equal(guardedSecretSteps.length, 2, 'health-check must gate both Cloudflare-secret steps to main');
assert.equal((health.match(/secrets\.CLOUDFLARE_WORKERS_API_TOKEN/g) ?? []).length, 2, 'health-check secret usage changed; review gates');

for (const file of ['deploy-cloudflare-pages.yml', 'deploy-cloudflare-workers.yml']) {
  const text = workflow(file);
  assert.match(text, /github\.ref == 'refs\/heads\/main'/, file + ': production workflow must be main-only');
  assert.match(text, /inputs\.confirm_production/, file + ': production workflow must require explicit confirmation');
}

const secretReference = new RegExp(String.fromCharCode(36) + '\{\{\s*secrets\.');
for (const file of ['deploy-auth-app-preview.yml', 'test-email-verification-preview-http.yml', 'staging-google-oauth-integration.yml']) {
  assert.doesNotMatch(workflow(file), secretReference, file + ': Preview workflow must remain credential-free');
}

console.log('PASS: secret-bearing Cloudflare workflows are restricted to trusted main; PR-safe Preview workflows remain credential-free.');
