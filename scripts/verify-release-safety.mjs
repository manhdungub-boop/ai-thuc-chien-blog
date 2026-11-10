import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const workers = await read(".github/workflows/deploy-cloudflare-workers.yml");
const pages = await read(".github/workflows/deploy-cloudflare-pages.yml");
const previewD1 = await read(".github/workflows/migrate-preview-d1.yml");
const authPreview = await read(".github/workflows/deploy-auth-app-preview.yml");
const configureBuilds = await read(".github/workflows/configure-cloudflare-worker-builds.yml");

assert.ok(configureBuilds.includes("confirm_production_trigger_changes:"));
assert.ok(configureBuilds.includes("default: false"));
assert.ok(configureBuilds.includes("CONFIRM_PRODUCTION_TRIGGER_CHANGES: ${{ inputs.confirm_production_trigger_changes }}"));
assert.ok(workers.includes("github.event_name == 'workflow_dispatch'"));
assert.ok(workers.includes("github.ref == 'refs/heads/main'"));
assert.ok(workers.includes("inputs.confirm_production_worker_and_d1_changes == true"));
assert.ok(pages.includes("github.event_name == 'workflow_dispatch'"));
assert.ok(pages.includes("github.ref == 'refs/heads/main'"));
assert.ok(pages.includes("inputs.confirm_production_pages_deploy == true"));
assert.ok(pages.includes("ref: main"));
assert.ok(pages.includes("concurrency:"));
assert.ok(!previewD1.includes("\n  push:"));
assert.ok(previewD1.includes("if: github.ref == 'refs/heads/main'"));
assert.ok(previewD1.includes("ref: main"));
assert.ok(previewD1.includes("51d814c8-a3fc-4481-a5f1-60bc67617f3c"));
assert.ok(previewD1.includes("ai-thuc-chien-community-preview"));
assert.ok(!previewD1.includes("\n    env:\n      CLOUDFLARE_API_TOKEN:"));
assert.ok(!previewD1.includes("\n    env:\n      CLOUDFLARE_WORKERS_API_TOKEN:"));
assert.ok(previewD1.includes("CLOUDFLARE_WORKERS_API_TOKEN: ${{ secrets.CLOUDFLARE_WORKERS_API_TOKEN }}"));

// Auth Preview is intentionally credential-free static validation now, not a deploy workflow.
// Do not require a deploy confirmation input for a workflow that cannot deploy anything.
assert.ok(!authPreview.includes("\n  push:"), "Auth Preview validation must not run automatically on push.");
assert.ok(authPreview.includes("workflow_dispatch:"));
assert.ok(authPreview.includes("source_ref:"));
assert.ok(authPreview.includes("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/sync/gitlab-completed-work-20261107'"),
  "Auth Preview validation must be manually dispatched only from the exact integration ref.");
assert.ok(authPreview.includes("persist-credentials: false"));
assert.ok(!authPreview.includes("${{ secrets."), "Auth Preview validation must not expose GitHub secrets.");
assert.ok(!authPreview.includes("CLOUDFLARE_API_TOKEN"));
assert.ok(!authPreview.includes("wrangler deploy"));
assert.ok(!authPreview.includes("d1 migrations apply"));
assert.ok(authPreview.includes("No Worker deployment, D1 operation, DNS change, or Production operation is performed"));

console.log("PASS: Worker and Pages Production deploys require manual main-ref confirmation.");
console.log("PASS: Preview D1 migrations run only from reviewed main and use the fixed Preview database.");
console.log("PASS: Cloudflare tokens are scoped to individual Preview verification/migration steps.");
console.log("PASS: Auth Preview workflow is restricted to credential-free static validation and cannot deploy or mutate Cloudflare resources.");
