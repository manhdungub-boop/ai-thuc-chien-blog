import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async path => readFile(new URL("../.github/workflows/" + path, import.meta.url), "utf8");
const health = await read("health-check.yml");
const diagnoseBuild = await read("diagnose-cloudflare-worker-build.yml");
const diagnoseD1 = await read("diagnose-community-d1.yml");
const verifyToken = await read("verify-cloudflare-deploy-token.yml");
const repairLegacy = await read("repair-cloudflare-branch-preview-triggers.yml");
const pages = await read("deploy-cloudflare-pages.yml");
const workers = await read("deploy-cloudflare-workers.yml");
const previewD1 = await read("migrate-preview-d1.yml");
const configureBuilds = await read("configure-cloudflare-worker-builds.yml");

const trustedMain = /github\.ref == 'refs\/heads\/main'/;
const explicitConfirm = /inputs\.[a-z0-9_]+ == true/;

assert.equal((health.match(/if: \(github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_branch == 'main'\) \|\| \(github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\)/g) || []).length, 2,
  "Both health-check steps carrying the Cloudflare token must be restricted to successful main workflow runs or manual main dispatch.");
assert.match(diagnoseBuild, /confirm_read_only_diagnosis:[\s\S]*?default: false/);
assert.match(diagnoseBuild, trustedMain);
assert.match(diagnoseBuild, explicitConfirm);
assert.match(diagnoseD1, /confirm_read_only_diagnosis:[\s\S]*?default: false/);
assert.match(diagnoseD1, trustedMain);
assert.match(diagnoseD1, explicitConfirm);
assert.match(diagnoseD1, /ref: main/);
assert.match(diagnoseD1, /persist-credentials: false/);
assert.match(verifyToken, /confirm_read_only_token_check:[\s\S]*?default: false/);
assert.match(verifyToken, trustedMain);
assert.match(verifyToken, explicitConfirm);
assert.doesNotMatch(repairLegacy, /secrets\.|api\.cloudflare\.com|curl\b|--request\s+(?:POST|PATCH|PUT|DELETE)|api_mutate/i,
  "Legacy trigger repair must not access secrets or mutate Cloudflare.");
assert.match(repairLegacy, /Disabled: legacy trigger repair has unverified Worker identity/);
assert.match(pages, /github\.ref == 'refs\/heads\/main'/);
assert.match(pages, /confirm_production_pages_deploy == true/);
assert.match(workers, /github\.ref == 'refs\/heads\/main'/);
assert.match(workers, /confirm_production_worker_and_d1_changes == true/);
assert.match(previewD1, trustedMain);
assert.match(previewD1, /ref: main/);
assert.match(previewD1, /51d814c8-a3fc-4481-a5f1-60bc67617f3c/);
assert.match(configureBuilds, /test_configure_cloudflare_worker_builds\.py/);
assert.doesNotMatch(configureBuilds, /secrets\.|api\.cloudflare\.com|wrangler (?:deploy|preview)/);
console.log("PASS: all Cloudflare secret-bearing diagnostics require trusted-main dispatch and explicit confirmation.");
console.log("PASS: legacy trigger repair is disabled; Workers Builds updater is offline-only.");
console.log("PASS: Production deploys require explicit confirmation from main; D1 migration is locked to the Preview UUID.");
