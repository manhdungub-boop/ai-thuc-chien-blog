import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const workers = await read(".github/workflows/deploy-cloudflare-workers.yml");
const pages = await read(".github/workflows/deploy-cloudflare-pages.yml");
const previewD1 = await read(".github/workflows/migrate-preview-d1.yml");
const authPreview = await read(".github/workflows/deploy-auth-app-preview.yml");

assert.match(workers, /github\\.event_name == 'workflow_dispatch'/);
assert.match(workers, /github\\.ref == 'refs\\/heads\\/main'/);
assert.match(workers, /inputs\\.confirm_production_worker_and_d1_changes == true/);
assert.match(pages, /github\\.event_name == 'workflow_dispatch'/);
assert.match(pages, /github\\.ref == 'refs\\/heads\\/main'/);
assert.match(pages, /inputs\\.confirm_production_pages_deploy == true/);
assert.match(pages, /ref: main/);
assert.match(pages, /concurrency:/);
assert.doesNotMatch(previewD1, /(^|\\n)  push:/);
assert.match(previewD1, /if: github\\.ref == 'refs\\/heads\\/main'/);
assert.match(previewD1, /ref: main/);
assert.match(previewD1, /51d814c8-a3fc-4481-a5f1-60bc67617f3c/);
assert.match(previewD1, /ai-thuc-chien-community-preview/);
assert.doesNotMatch(previewD1, /(^|\\n)    env:\\n      CLOUDFLARE_(WORKERS_)?API_TOKEN:/);
assert.match(previewD1, /env:\\n\\s+\\s+CLOUDFLARE_WORKERS_API_TOKEN: \\$\\{\\{ secrets\\.CLOUDFLARE_WORKERS_API_TOKEN \\}\\}/);

// Auth Preview is intentionally credential-free static validation now, not a deploy workflow.
// Do not require a deploy confirmation input for a workflow that cannot deploy anything.
assert.ok(!authPreview.includes("  push:"), "Auth Preview validation must not run automatically on push.");
assert.match(authPreview, /workflow_dispatch:/);
assert.match(authPreview, /source_ref:/);
assert.ok(authPreview.includes("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/sync/gitlab-completed-work-20261107'"),
  "Auth Preview validation must be manually dispatched only from the exact integration ref.");
assert.match(authPreview, /persist-credentials: false/);
assert.doesNotMatch(authPreview, /\\$\\{\\{\\s*secrets\\./);
assert.doesNotMatch(authPreview, /CLOUDFLARE_API_TOKEN|wrangler[^\\n]*\\bdeploy\\b|d1[^\\n]*migrations[^\\n]*\\bapply\\b/i);
assert.match(authPreview, /No Worker deployment, D1 operation, DNS change, or Production operation is performed/);

console.log("PASS: Worker and Pages Production deploys require manual main-ref confirmation.");
console.log("PASS: Preview D1 migrations run only from reviewed main and use the fixed Preview database.");
console.log("PASS: Cloudflare tokens are scoped to individual Preview verification/migration steps.");
console.log("PASS: Auth Preview workflow is restricted to credential-free static validation and cannot deploy or mutate Cloudflare resources.");
