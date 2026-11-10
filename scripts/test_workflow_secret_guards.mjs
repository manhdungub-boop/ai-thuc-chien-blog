import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = (name) => readFileSync(new URL('../.github/workflows/' + name, import.meta.url), 'utf8');
const jobGuard = (text, job) => text.includes("  " + job + ":\n    if: github.ref == 'refs/heads/main'");

for (const [file, job] of [
  ['configure-cloudflare-worker-builds.yml', 'configure-triggers'],
  ['diagnose-cloudflare-worker-build.yml', 'diagnose'],
  ['diagnose-community-d1.yml', 'inspect'],
  ['repair-cloudflare-branch-preview-triggers.yml', 'disabled'],
  ['verify-cloudflare-deploy-token.yml', 'verify'],
  ['migrate-preview-d1.yml', 'preview-d1'],
]) {
  assert.ok(jobGuard(workflow(file), job), file + ': ' + job + ' must run only from refs/heads/main');
}

const legacyRepair = workflow('repair-cloudflare-branch-preview-triggers.yml');
assert.ok(legacyRepair.includes('Legacy Cloudflare Branch Preview Trigger Repair (Disabled)'), 'stale Preview repair workflow must be clearly disabled');
assert.doesNotMatch(legacyRepair, /\$\{\{\s*secrets\./, 'disabled legacy workflow must not receive Cloudflare secrets');
assert.doesNotMatch(legacyRepair, /api_mutate|curl|builds\/triggers|wrangler deploy/i, 'disabled legacy workflow must not call Cloudflare APIs or deploy');

const configureBuilds = workflow('configure-cloudflare-worker-builds.yml');
const configureUpdater = readFileSync(new URL('../scripts/configure_cloudflare_worker_builds.py', import.meta.url), 'utf8');
assert.match(configureBuilds, /preview_trigger_uuid:[\s\S]*?required: true/, 'Workers Builds updater must require an exact Preview trigger UUID');
assert.match(configureBuilds, /preview_worker_tag:[\s\S]*?required: true/, 'Workers Builds updater must require an exact Preview Worker tag');
assert.match(configureBuilds, /preview_branch:[\s\S]*?required: true/, 'Workers Builds updater must require an exact non-production branch');
assert.ok(!configureBuilds.includes('confirm_production_trigger_changes'), 'Workers Builds workflow must not expose a Production-write switch');
assert.ok(!configureBuilds.includes('CONFIRM_PRODUCTION_TRIGGER_CHANGES'), 'Workers Builds workflow must not pass a Production-write switch');
assert.ok(!configureBuilds.includes('preview_reuse_primary_build_token'), 'Preview updater must not reuse a Production build token');
assert.ok(!configureUpdater.includes('PRODUCTION_TRIGGERS'), 'Preview updater must not define Production trigger targets');
assert.ok(configureUpdater.includes('Production Workers Builds triggers are never queried or modified'), 'Preview updater must keep Production outside its API path');
assert.ok(configureUpdater.includes('ALLOWED_PREVIEW_DEPLOY_COMMANDS'), 'Preview updater must enforce an explicit safe deploy-command allowlist');

const health = workflow('health-check.yml');
const healthGuard = "if: (github.event_name == 'workflow_run' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'";
assert.equal(health.split('\n').filter((line) => line.trim() === healthGuard).length, 2, 'health-check must gate both Cloudflare-secret steps to main');
assert.equal((health.match(/secrets\.CLOUDFLARE_WORKERS_API_TOKEN/g) ?? []).length, 2, 'health-check secret usage changed; review gates');

for (const file of ['deploy-cloudflare-pages.yml', 'deploy-cloudflare-workers.yml']) {
  const text = workflow(file);
  assert.ok(text.includes("github.ref == 'refs/heads/main'"), file + ': production workflow must be main-only');
  assert.ok(text.includes('inputs.confirm_production'), file + ': production workflow must require explicit confirmation');
}

const oauth = workflow('staging-google-oauth-integration.yml');
assert.match(oauth, /uses: actions\/checkout@v4\n        with:\n          persist-credentials: false/, 'OAuth PR workflow must not persist its read-only GitHub token into the checkout');

const secretReference = /\$\{\{\s*secrets\./;
for (const file of ['deploy-auth-app-preview.yml', 'test-email-verification-preview-http.yml', 'staging-google-oauth-integration.yml']) {
  assert.doesNotMatch(workflow(file), secretReference, file + ': Preview workflow must remain credential-free');
}

console.log('PASS: secret-bearing Cloudflare workflows are restricted to trusted main; PR-safe Preview workflows are credential-free and checkout tokens are not persisted.');
