import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ci = await readFile(new URL("../.gitlab-ci.yml", import.meta.url), "utf8");
const lines = ci.split(/\r?\n/);
const topLevelKeys = lines
  .filter((line) => /^[A-Za-z0-9_.-]+:\s*$/.test(line))
  .map((line) => line.replace(/:\s*$/, ""));

assert.deepEqual(
  topLevelKeys,
  ["workflow", "stages", "staging-content-routing-tests", "javascript-validation", "staging-worker-dry-run", "staging-email-registration-e2e", "staging-email-confirmation-e2e", "staging-password-reset-request-e2e", "staging-password-reset-finish-e2e", "migration-validation", "ai-catalog-quality-gate", "ai-catalog-public-link-check", "static-bundle-validation", "staging-worker-assets-release", "isolated-worker-dry-run", "isolated-worker-assets-release"],
  "CI must contain only the reviewed workflow, validation jobs, and isolated staging dry-run job"
);
console.log("PASS only the reviewed top-level CI workflow, stage, and jobs exist");

const staticBundleJob = (() => {
  const start = lines.findIndex((line) => line === "static-bundle-validation:");
  assert.ok(start >= 0, "Static bundle validation job must be present.");
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[end])) end++;
  return lines.slice(start + 1, end).join("\n");
})();
assert.ok(staticBundleJob.includes("stage: validate"), "Static bundle validation must remain in the validation stage.");
assert.ok(staticBundleJob.includes("node scripts/run-production-static-preflight.mjs"), "Static bundle validation must run the production static preflight.");
assert.ok(staticBundleJob.includes("node scripts/package-production-static.mjs"), "Static bundle validation must package the reviewed static output.");
assert.ok(staticBundleJob.includes("node scripts/build-preview.mjs"), "Static bundle validation must build the noindex preview output.");
assert.ok(!staticBundleJob.includes("wrangler") && !staticBundleJob.includes("deploy"), "Static bundle validation must never deploy a Worker.");
console.log("PASS static bundle validation is a build-only staging gate with no Worker deployment");

const stagingReleaseJob = (() => {
  const start = lines.findIndex((line) => line === "staging-worker-assets-release:");
  assert.ok(start >= 0, "The staging asset release job must be present.");
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
})();
assert.ok(stagingReleaseJob.includes("when: manual"), "Staging asset release must require a manual trigger.");
assert.ok(stagingReleaseJob.includes("allow_failure: true"), "Staging asset release must remain optional before approval.");
assert.ok(stagingReleaseJob.includes('$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "feature/social-login-google-facebook-20261101"'), "Staging release must be restricted to the reviewed OAuth MR.");
assert.ok(stagingReleaseJob.includes('$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "staging/auth-worker-build"') && stagingReleaseJob.includes('$CI_COMMIT_BRANCH == "staging/auth-worker-build"'), "Staging release may run from the dedicated protected Staging branch only.");
assert.ok(stagingReleaseJob.includes('$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "feature/account-profile-staging-20261102"') && stagingReleaseJob.includes('$CI_COMMIT_BRANCH == "feature/account-profile-staging-20261102"'), "Staging release may run for the reviewed account-profile Staging branch only.");
assert.ok(stagingReleaseJob.includes("name: staging") && stagingReleaseJob.includes("deployment_tier: staging"), "Release environment must be staging only.");
assert.ok(stagingReleaseJob.includes("resource_group: ai-thuc-chien-blog-staging"), "Staging release must be serialized.");
assert.ok(stagingReleaseJob.includes("CLOUDFLARE_API_TOKEN") && stagingReleaseJob.includes("wrangler.staging.toml"), "Staging release must use the explicit Cloudflare token and staging config.");
assert.ok(stagingReleaseJob.includes("--secrets-file /tmp/wrangler-preserve-secrets.json"), "Staging release must preserve existing remote secrets.");
assert.ok(stagingReleaseJob.includes("node scripts/test-live-staging-assets.mjs"), "Staging release must verify the live static assets after deploy.");
assert.ok(stagingReleaseJob.includes("needs:") && stagingReleaseJob.includes("javascript-validation") && stagingReleaseJob.includes("migration-validation") && stagingReleaseJob.includes("staging-worker-dry-run"), "Staging release must wait for all required validation jobs.");
assert.ok(!stagingReleaseJob.includes("production") && !stagingReleaseJob.includes("keep_assets: true"), "Staging release must not target production or reuse stale assets.");
console.log("PASS staging release is manually gated, serialized, asset-complete, secret-preserving and validation-dependent");

const catalogQualityJob = (() => {
  const start = lines.findIndex((line) => line === "ai-catalog-quality-gate:");
  assert.ok(start >= 0, "AI catalog quality gate must be explicitly present");
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[end])) end++;
  return lines.slice(start + 1, end).join("\n");
})();
assert.ok(catalogQualityJob.includes("stage: validate"), "AI catalog quality gate must remain in validation stage");
assert.ok(catalogQualityJob.includes('$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "staging/auth-worker-build"'), "AI catalog quality gate must run automatically for MRs targeting staging");
assert.ok(catalogQualityJob.includes('$CI_COMMIT_BRANCH == "staging/auth-worker-build"'), "AI catalog quality gate must run on the protected staging branch");
assert.ok(catalogQualityJob.includes("when: never"), "AI catalog quality gate must be disabled unless its explicit staging rules match");
assert.ok(!catalogQualityJob.includes("deploy"), "AI catalog quality gate must not deploy");

const catalogLinkJob = (() => {
  const start = lines.findIndex((line) => line === "ai-catalog-public-link-check:");
  assert.ok(start >= 0, "AI catalog public-link check must be explicitly present");
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[end])) end++;
  return lines.slice(start + 1, end).join("\n");
})();
assert.ok(catalogLinkJob.includes("stage: validate"), "AI catalog public-link check must remain in validation stage");
assert.ok(catalogLinkJob.includes('$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "staging/auth-worker-build"'), "AI catalog link check must run automatically for MRs targeting staging");
assert.ok(catalogLinkJob.includes('$CI_COMMIT_BRANCH == "staging/auth-worker-build"'), "AI catalog link check must run on the protected staging branch");
assert.ok(catalogLinkJob.includes("when: never"), "AI catalog link check must be disabled unless its explicit staging rules match");
assert.ok(catalogLinkJob.includes("allow_failure: true"), "Public-link check must remain non-blocking because external sites can rate-limit or reject automated checks");
assert.ok(!catalogLinkJob.includes("deploy"), "AI catalog public-link check must not deploy");
console.log("PASS AI catalog checks are opt-in, staging-scoped, validation-only, and public-link checking is non-blocking");

const stagesMatch = ci.match(/^stages:\s*\r?\n((?:[ \t]+-[ \t]+[^\r\n]+\r?\n?)+)/m);
assert.ok(stagesMatch, "CI stages block must exist");
const stages = stagesMatch[1]
  .split(/\r?\n/)
  .map((line) => line.replace(/^\s*-\s*/, "").trim())
  .filter(Boolean);
assert.deepEqual(stages, ["validate", "staging-build-check"], "CI may add only the isolated staging dry-run stage");
console.log("PASS CI has validation plus an isolated staging dry-run stage");
assert.ok(ci.includes("if: '$CI_COMMIT_BRANCH == \"staging/auth-worker-build\"'"), "Staging dry-run job must be restricted to the dedicated staging branch");
assert.ok(ci.includes("if: '$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == \"staging/auth-worker-build\"'"), "Staging dry-run must also run in the dedicated staging branch's review MR");
assert.ok(ci.includes("if: '$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == \"feature/account-profile-staging-20261102\"'") && ci.includes("if: '$CI_COMMIT_BRANCH == \"feature/account-profile-staging-20261102\"'"), "Account-profile dry-run is limited to its reviewed Staging branch.");
assert.ok(ci.includes("if: '$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == \"fix/social-login-coming-soon-20261102\"'") && ci.includes("if: '$CI_COMMIT_BRANCH == \"fix/social-login-coming-soon-20261102\"'"), "Social login coming-soon dry-run is limited to its reviewed Staging branch.");
assert.ok(ci.includes("if: '$CI_COMMIT_BRANCH == \"fix/staging-google-oidc-isolated-20261103\"'") && ci.includes("if: '$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == \"fix/staging-google-oidc-isolated-20261103\"'"), "Isolated Google OIDC dry-run is limited to its reviewed Staging branch.");
assert.ok(ci.includes("npx --yes wrangler@latest deploy --dry-run --config wrangler.staging.toml"), "Staging job must use Wrangler dry-run only");
assert.ok(ci.includes('$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "fix/isolated-worker-assets-release-20261104"'), "Isolated Worker dry-run must be limited to its reviewed MR branch.");
assert.ok(ci.includes('$CI_COMMIT_BRANCH == "fix/isolated-worker-assets-release-20261104"'), "Isolated Worker dry-run must be limited to its dedicated branch.");
assert.ok(ci.includes("npx --yes wrangler@latest deploy --dry-run --config wrangler.isolated.toml"), "Isolated Worker gate must run Wrangler dry-run only before any manual release.");
const isolatedReleaseJob = (() => {
  const start = lines.findIndex((line) => line === "isolated-worker-assets-release:");
  assert.ok(start >= 0, "Isolated Worker release job must be explicitly present.");
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_.-]+:\\s*$/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
})();
assert.ok(isolatedReleaseJob.includes("when: manual") && isolatedReleaseJob.includes("allow_failure: true"), "Isolated Worker release must remain manual and optional.");
assert.ok(isolatedReleaseJob.includes("name: isolated-test") && isolatedReleaseJob.includes("deployment_tier: testing"), "Isolated release must use a testing-only environment.");
assert.ok(isolatedReleaseJob.includes("resource_group: ai-thuc-chien-blog-isolated-test"), "Isolated release must be serialized separately.");
assert.ok(isolatedReleaseJob.includes("wrangler.isolated.toml") && isolatedReleaseJob.includes("node scripts/test-live-isolated-assets.mjs"), "Isolated release must use its dedicated Worker config and live smoke.");
assert.ok(isolatedReleaseJob.includes("needs:") && isolatedReleaseJob.includes("javascript-validation") && isolatedReleaseJob.includes("migration-validation") && isolatedReleaseJob.includes("isolated-worker-dry-run"), "Isolated release must wait for all validation and dry-run gates.");
assert.ok(!isolatedReleaseJob.includes("wrangler.toml") && !isolatedReleaseJob.includes("wrangler.staging.toml") && !/d1 execute|production/i.test(isolatedReleaseJob), "Isolated release must not target Staging or Production.");

assert.ok(ci.includes("if: '$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == \"integration/staging-content-auth-sync-20261028\"'"), "Content/auth sync dry-run is limited to the isolated integration MR.");
assert.ok(ci.includes("if: '$CI_COMMIT_BRANCH == \"integration/staging-content-auth-sync-20261028\"'"), "Content/auth sync dry-run is limited to the isolated integration branch.");

const liveE2EJobs = [
  ["staging-email-registration-e2e", "register"],
  ["staging-email-confirmation-e2e", "confirm"],
  ["staging-password-reset-request-e2e", "request-reset"],
  ["staging-password-reset-finish-e2e", "finish-reset"],
];
for (const [jobName, action] of liveE2EJobs) {
  const start = lines.findIndex((line) => line === jobName + ":");
  assert.ok(start >= 0, "Live email E2E job must be explicitly present: " + jobName);
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[end])) end++;
  const block = lines.slice(start + 1, end).join("\n");
  assert.ok(block.includes("when: manual"), jobName + " must be manual in normal branch/MR pipelines.");
  assert.ok(block.includes("allow_failure: true"), jobName + " must remain optional.");
  assert.ok(block.includes('$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "staging/auth-worker-build"'), jobName + " must be limited to the staging review MR.");
  assert.ok(block.includes('$CI_COMMIT_BRANCH == "staging/auth-worker-build"'), jobName + " must be limited to the staging branch.");
  assert.ok(!block.includes("$CI_PIPELINE_SOURCE"), jobName + " must not auto-run from pipeline source rules.");
  assert.ok(!block.includes("STAGING_EMAIL_E2E_ACTION"), jobName + " must not depend on a project-level action selector.");
  assert.ok(block.includes("node scripts/test-live-staging-email-e2e.mjs"), jobName + " must use the reviewed staging-only test.");
}
assert.ok(!ci.includes("$CI_PIPELINE_SOURCE =~ /^(api|web)$/"), "The workflow must not specially auto-create live-email jobs on API/web pipeline sources.");
assert.ok(!ci.includes("$STAGING_EMAIL_E2E_ACTION"), "Live-email jobs must not depend on a persistent project-level action selector.");
console.log("PASS live email E2E jobs are manual-only and cannot auto-run through API/web pipelines");

const draftPreviewConfig = await readFile(new URL("../wrangler.drafts-preview.toml", import.meta.url), "utf8");
const draftPreviewWorker = await readFile(new URL("../drafts-preview-worker.mjs", import.meta.url), "utf8");
const draftPreviewBuilder = await readFile(new URL("./build-draft-preview.mjs", import.meta.url), "utf8");

const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
assert.equal(packageManifest.devDependencies.marked, "18.1.2", "Markdown parser dependency must be pinned exactly.");
assert.equal(packageLock.packages["node_modules/marked"].version, "18.1.2", "Lockfile must pin the same Markdown parser version.");
assert.equal(packageLock.packages["node_modules/marked"].license, "MIT", "Markdown parser license must be MIT.");
assert.equal(packageLock.packages["node_modules/marked"].integrity, "sha512-DfOnvLAQ6WYeWxWO1u4RyFOeqyHup6dks5PPqnoFiooU7ipRvidO/2j8plhAHIiZg574E9ZlzSjUiPMLAzFkgg==", "Markdown parser package integrity must match npm registry metadata.");
assert.ok(draftPreviewConfig.includes('name = "ai-thuc-chien-blog-drafts-preview"'), "Draft preview must use a dedicated Worker name.");
assert.ok(draftPreviewConfig.includes('directory = "./draft-preview-output"'), "Draft preview must serve only its generated output directory.");
assert.ok(draftPreviewConfig.includes('binding = "ASSETS"'), "Draft preview must use a static ASSETS binding.");
assert.ok(draftPreviewConfig.includes("workers_dev = false") && draftPreviewConfig.includes("preview_urls = false"), "Draft preview must not expose a public workers.dev or preview URL before access control is configured.");
assert.ok(!/d1_databases|\[vars\]|\[secrets\]|routes\s*=|custom_domain/i.test(draftPreviewConfig), "Draft preview config must not include D1, secrets, variables, routes or custom domains.");
assert.ok(draftPreviewWorker.includes('request.method !== "GET"') && draftPreviewWorker.includes('request.method !== "HEAD"'), "Draft preview must be read-only.");
assert.ok(draftPreviewWorker.includes('env.ASSETS.fetch'), "Draft preview must serve static assets only.");
assert.ok(!/fetch\s*\(\s*["']https?:|D1Database|\.prepare\(|\.bind\(/i.test(draftPreviewWorker), "Draft preview Worker must not call external APIs or D1.");
assert.ok(draftPreviewBuilder.includes('assert.equal(meta.status, "draft"'), "Draft preview builder must reject non-draft content.");
assert.ok(draftPreviewBuilder.includes('assert.equal(meta.author, "DUNG - AI"'), "Draft preview builder must enforce the required author.");
console.log("PASS draft preview is a separate read-only ASSETS Worker with no D1, secrets, production routes or publication path");

const javascriptValidationJob = (() => {
  const start = lines.findIndex((line) => line === "javascript-validation:");
  assert.ok(start >= 0, "JavaScript validation job must exist");
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
})();
assert.ok(javascriptValidationJob.includes("npm ci --ignore-scripts --no-audit --no-fund --cache .npm --prefer-offline"), "CI must install only the exact locked dependencies.");
assert.ok(javascriptValidationJob.includes("expire_in: 7 days"), "Draft preview artifact must expire after seven days.");
assert.ok(javascriptValidationJob.includes("- draft-preview-output/"), "Only generated draft preview output must be stored as a CI artifact.");
console.log("PASS generated draft preview is retained only as a short-lived GitLab CI artifact");

const approvedCommands = [
  "node --check scripts/test-staging-content-routing.mjs",
  "node scripts/test-staging-content-routing.mjs",
  "cp email-relay/Code.gs /tmp/email-relay.js",
  "npm ci --ignore-scripts --no-audit --no-fund --cache .npm --prefer-offline",
  "node --check /tmp/email-relay.js",
  "node --check recovery-snapshots/worker.mjs",
  "node --check scripts/test-route-resolution.mjs",
  "node --check recovery-snapshots/worker-email-verification-candidate.mjs",
  "node --check recovery-snapshots/auth-app-preview.mjs",
  "node --check recovery-snapshots/auth-preview.mjs",
  "node --check site-snapshot/script.js",
  "node --check site-snapshot/account-profile.js",
  "node --check scripts/verify-recovery.mjs",
  "node --check scripts/verify-static-snapshot.mjs",
  "node --check scripts/verify-article-diagrams.mjs",
  "node --check scripts/verify-article-attribution.mjs",
  "node --check scripts/verify-email-verification-candidate.mjs",
  "node --check scripts/test-worker-email-verification.mjs",
  "node --check scripts/test-worker-email-verification-boundaries.mjs",
  "node --check scripts/test-email-relay.mjs",
  "node --check scripts/test-password-reset.mjs",
  "node --check scripts/test-social-auth.mjs",
  "node --check scripts/build-draft-preview.mjs",
  "node --check scripts/test-draft-preview.mjs",
  "node scripts/test-draft-preview.mjs",
  "node --check scripts/test-live-staging-assets.mjs",
  "node scripts/test-social-auth.mjs",
  "node --check tests/staging-google-oidc-runtime.test.mjs",
  "node --test tests/staging-google-oidc-runtime.test.mjs",
  "node --check scripts/verify-staging-google-oidc-hardening.mjs",
  "node scripts/verify-staging-google-oidc-hardening.mjs",
  "node --check scripts/test-staging-health.mjs",
  "node --check scripts/test-live-staging-email-e2e.mjs",
  "node --check scripts/test-organization-logo-rewrite.mjs",
  "node --check staging-entrypoint.mjs",
  "node --check scripts/verify-staging-build-config.mjs",
  "node scripts/test-route-resolution.mjs",
  "node scripts/verify-recovery.mjs",
  "node scripts/verify-static-snapshot.mjs",
  "node scripts/verify-article-diagrams.mjs",
  "node scripts/verify-article-attribution.mjs",
  "node scripts/verify-email-verification-candidate.mjs",
  "node scripts/test-worker-email-verification.mjs",
  "node scripts/test-worker-email-verification-boundaries.mjs",
  "node scripts/test-email-relay.mjs",
  "node scripts/test-password-reset.mjs",
  "node scripts/test-organization-logo-rewrite.mjs",
  "node scripts/verify-staging-config.mjs",
  "node scripts/verify-staging-build-config.mjs",
  "node --check preview-content-worker.mjs",
  "node --check scripts/test-preview-content-worker.mjs",
  "node --check scripts/test-live-content-preview-mcp-candidate.mjs",
  "node scripts/test-preview-content-worker.mjs",
  "node --check scripts/verify-release-safety.mjs",
  "node scripts/verify-release-safety.mjs",
  "'if [ \"${CI_COMMIT_BRANCH:-}\" = \"feature/required-email-verification-staging\" ] || [ \"${CI_MERGE_REQUEST_SOURCE_BRANCH_NAME:-}\" = \"feature/required-email-verification-staging\" ] || [ \"${CI_COMMIT_BRANCH:-}\" = \"staging/auth-worker-build\" ] || [ \"${CI_MERGE_REQUEST_SOURCE_BRANCH_NAME:-}\" = \"staging/auth-worker-build\" ]; then node scripts/test-staging-health.mjs; else echo \"Skipping read-only staging status check outside the auth/staging branches or MRs.\"; fi'",
  "node scripts/verify-staging-build-config.mjs",
  "npx --yes wrangler@latest deploy --dry-run --config wrangler.staging.toml",
  "node scripts/test-live-staging-email-e2e.mjs register",
  "node scripts/test-live-staging-email-e2e.mjs confirm",
  "node scripts/test-live-staging-email-e2e.mjs request-reset",
  "node scripts/test-live-staging-email-e2e.mjs finish-reset",
  "python scripts/verify-migrations.py",
  "python scripts/generate-article-diagrams.py --check",
  "python scripts/audit-article-similarity.py --threshold 0.08",
  "python scripts/audit-draft-similarity.py --threshold 0.08",
  "node --check scripts/validate-ai-tools-catalog.mjs",
  "node --check scripts/test-ai-tools-catalog-ui.mjs",
  "node --check scripts/audit-ai-tools-catalog.mjs",
  "node --check scripts/check-ai-tools-links.mjs",
  "node scripts/validate-ai-tools-catalog.mjs",
  "node scripts/test-ai-tools-catalog-ui.mjs",
  "node scripts/audit-ai-tools-catalog.mjs --strict",
  "node --check scripts/check-ai-tools-links.mjs",
  "node scripts/check-ai-tools-links.mjs",
  "node scripts/run-production-static-preflight.mjs",
  "node scripts/package-production-static.mjs",
  "node scripts/build-preview.mjs",
  'test -n "$CLOUDFLARE_API_TOKEN" || { echo "Missing masked CI/CD variable CLOUDFLARE_API_TOKEN; deployment skipped."; exit 1; }',
  "export CLOUDFLARE_ACCOUNT_ID=\"92cf091bbac8b4879ec65feb30b4715b\"",
  "printf '{}\\n' > /tmp/wrangler-preserve-secrets.json",
  "npx --yes wrangler@latest deploy --config wrangler.staging.toml --secrets-file /tmp/wrangler-preserve-secrets.json",
  "node scripts/test-live-staging-assets.mjs",
  "node --check scripts/verify-isolated-build-config.mjs",
  "node scripts/verify-isolated-build-config.mjs",
  "npx --yes wrangler@latest deploy --dry-run --config wrangler.isolated.toml",
  'test -n "$CLOUDFLARE_API_TOKEN" || { echo "Missing masked CI/CD variable CLOUDFLARE_API_TOKEN; deployment skipped."; exit 1; }',
  "export CLOUDFLARE_ACCOUNT_ID=\"92cf091bbac8b4879ec65feb30b4715b\"",
  "printf '{}\\\\n' > /tmp/wrangler-preserve-secrets.json",
  "npx --yes wrangler@latest deploy --config wrangler.isolated.toml --secrets-file /tmp/wrangler-preserve-secrets.json",
  "node scripts/test-live-isolated-assets.mjs"
];

const actualCommands = [];
let inScriptBlock = false;
for (const line of lines) {
  if (/^ {2}script:\s*$/.test(line)) {
    inScriptBlock = true;
    continue;
  }
  if (inScriptBlock && /^\s{4}-\s+/.test(line)) {
    actualCommands.push(line.replace(/^\s{4}-\s+/, "").trim());
    continue;
  }
  if (inScriptBlock && line.trim() && !/^\s{4}/.test(line)) inScriptBlock = false;
}

assert.deepEqual(
  actualCommands,
  approvedCommands,
  "CI script commands must exactly match the reviewed non-deploying allowlist; review both files before extending CI"
);
assert.ok(
  !/^(?:trigger|include)\s*:/m.test(ci),
  "CI must not add downstream triggers or imported pipelines without explicit review"
);
assert.ok(
  !/^environment\s*:/m.test(ci),
  "CI must not add a top-level deployment environment"
);
console.log("PASS every CI command matches the reviewed allowlist; only the explicitly gated staging release environment is permitted");
console.log("Release-safety gate passed. This checks repository CI policy only; it does not certify production readiness.");
