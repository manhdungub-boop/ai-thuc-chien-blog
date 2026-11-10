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

const codeql = workflow('codeql-security-analysis.yml');
assert.ok(codeql.includes('upload: never'), 'CodeQL must not upload SARIF while default setup is enabled');
assert.ok(codeql.includes('codeql-results') && codeql.includes('GITHUB_STEP_SUMMARY') && codeql.includes('tee -a'), 'CodeQL must retain local SARIF and print a safe findings summary in the workflow');
assert.ok(!codeql.includes('security-events: write'), 'Offline CodeQL must not request Code Scanning write permission');
assert.ok(codeql.includes('github/codeql-action/init@0911ee96d2d6c8def97122c36c5cadd93829a4b4') && codeql.includes('github/codeql-action/analyze@0911ee96d2d6c8def97122c36c5cadd93829a4b4'), 'CodeQL must use the supported v4 actions');
assert.ok(codeql.includes('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1') && codeql.includes('persist-credentials: false'), 'CodeQL checkout must not persist GitHub credentials');
assert.ok(codeql.includes('javascript-typescript') && codeql.includes('python') && codeql.includes('actions'), 'CodeQL must scan application code and GitHub Actions workflows');
assert.doesNotMatch(codeql, /\$\{\{\s*secrets\./, 'CodeQL workflow must not receive application secrets');
// Inspect executable action references and command lines only. Test names and
// assertions may legitimately mention Cloudflare without invoking its API.
assert.doesNotMatch(codeql, /^\s*uses:\s*[^#\n]*(?:cloudflare|wrangler)/im, 'CodeQL workflow must not invoke Cloudflare or Wrangler actions');
assert.doesNotMatch(codeql, /^\s*(?:wrangler\s+deploy|curl\b[^\n]*api\.cloudflare\.com)/im, 'CodeQL workflow must not deploy or call the Cloudflare API');

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
