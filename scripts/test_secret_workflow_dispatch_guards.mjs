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

const productionSmokeGuard = "if: github.event_name == 'schedule' || (github.event_name == 'workflow_run' && github.event.workflow_run.head_branch == 'main') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')";
assert.ok(health.includes(productionSmokeGuard), "Live Production smoke tests must run only on schedule or trusted main.");
const healthGuard = "if: (github.event_name == 'workflow_run' && github.event.workflow_run.head_branch == 'main') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')";
assert.equal(health.split(healthGuard).length - 1, 2,
  "Both health-check steps carrying the Cloudflare token must be restricted to successful main workflow runs or manual main dispatch.");

assert.ok(diagnoseBuild.includes("confirm_read_only_diagnosis:"));
assert.ok(diagnoseBuild.includes("default: false"));
assert.ok(diagnoseBuild.includes("if: github.ref == 'refs/heads/main' && inputs.confirm_read_only_diagnosis == true"));
assert.ok(diagnoseD1.includes("confirm_read_only_diagnosis:"));
assert.ok(diagnoseD1.includes("default: false"));
assert.ok(diagnoseD1.includes("if: github.ref == 'refs/heads/main' && inputs.confirm_read_only_diagnosis == true"));
assert.ok(diagnoseD1.includes("ref: main"));
assert.ok(diagnoseD1.includes("persist-credentials: false"));
assert.ok(verifyToken.includes("confirm_read_only_token_check:"));
assert.ok(verifyToken.includes("default: false"));
assert.ok(verifyToken.includes("if: github.ref == 'refs/heads/main' && inputs.confirm_read_only_token_check == true"));

assert.doesNotMatch(repairLegacy, /secrets\.|api\.cloudflare\.com|curl\b|--request\s+(?:POST|PATCH|PUT|DELETE)|api_mutate/i,
  "Legacy trigger repair must not access secrets or mutate Cloudflare.");
assert.ok(repairLegacy.includes("Disabled: legacy trigger repair has unverified Worker identity"));
assert.ok(pages.includes("github.ref == 'refs/heads/main'"));
assert.ok(pages.includes("confirm_production_pages_deploy == true"));
assert.ok(workers.includes("github.ref == 'refs/heads/main'"));
assert.ok(workers.includes("confirm_production_worker_and_d1_changes == true"));
assert.ok(previewD1.includes("github.ref == 'refs/heads/main'"));
assert.ok(previewD1.includes("ref: main"));
assert.ok(previewD1.includes("51d814c8-a3fc-4481-a5f1-60bc67617f3c"));
assert.ok(configureBuilds.includes("test_configure_cloudflare_worker_builds.py"));
assert.doesNotMatch(configureBuilds, /secrets\.|api\.cloudflare\.com|wrangler (?:deploy|preview)/);
console.log("PASS: all Cloudflare secret-bearing diagnostics require trusted-main dispatch and explicit confirmation.");
console.log("PASS: legacy trigger repair is disabled; Workers Builds updater is offline-only.");
console.log("PASS: Production deploys require explicit confirmation from main; D1 migration is locked to the Preview UUID.");
