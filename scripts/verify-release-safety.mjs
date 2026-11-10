import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const workers = await read(".github/workflows/deploy-cloudflare-workers.yml");
const pages = await read(".github/workflows/deploy-cloudflare-pages.yml");
const previewD1 = await read(".github/workflows/migrate-preview-d1.yml");
const authPreview = await read(".github/workflows/deploy-auth-app-preview.yml");
const emailPreview = await read(".github/workflows/test-email-verification-preview-http.yml");

assert.match(workers, /github\.event_name == 'workflow_dispatch'/);
assert.match(workers, /github\.ref == 'refs\/heads\/main'/);
assert.match(workers, /inputs\.confirm_production_worker_and_d1_changes == true/);
assert.match(pages, /github\.event_name == 'workflow_dispatch'/);
assert.match(pages, /github\.ref == 'refs\/heads\/main'/);
assert.match(pages, /inputs\.confirm_production_pages_deploy == true/);
assert.match(pages, /ref: main/);
assert.match(pages, /concurrency:/);
assert.doesNotMatch(previewD1, /(^|\n)  push:/);
assert.match(previewD1, /if: github\.ref == 'refs\/heads\/main'/);
assert.match(previewD1, /ref: main/);
assert.match(previewD1, /51d814c8-a3fc-4481-a5f1-60bc67617f3c/);
assert.match(previewD1, /ai-thuc-chien-community-preview/);
assert.doesNotMatch(previewD1, /(^|\n)    env:\n      CLOUDFLARE_(WORKERS_)?API_TOKEN:/);
assert.match(previewD1, /env:\n\s+\s+CLOUDFLARE_WORKERS_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_WORKERS_API_TOKEN \}\}/);
assert.match(authPreview, /workflow_dispatch:/);
assert.match(authPreview, /persist-credentials: false/);
assert.doesNotMatch(authPreview, /CLOUDFLARE_API_TOKEN|COMMUNITY_EMAIL_RELAY_SECRET|GOOGLE_OAUTH_CLIENT_SECRET|wrangler deploy|sync\/gitlab/i,
  "Auth Preview validation must be credential-free, GitHub-only, and non-deploying.");
assert.ok(emailPreview.includes("workflow_dispatch:"), "Email Preview smoke must be manual-only.");
assert.ok(!emailPreview.includes("push:"), "Email Preview smoke must not run on branch pushes.");
assert.ok(!emailPreview.includes("secrets.") && !emailPreview.includes("CLOUDFLARE_API_TOKEN"),
  "Email Preview smoke must not expose application or Cloudflare credentials.");
assert.ok(!/wrangler (?:preview|deploy|secret)/.test(emailPreview),
  "Email Preview smoke must not deploy or configure secrets.");
assert.ok(emailPreview.includes("scripts/test_community_preview_frontend.mjs"));
console.log("PASS: Worker and Pages Production deploys require manual main-ref confirmation.");
console.log("PASS: Preview D1 migrations run only from reviewed main and use the fixed Preview database.");
console.log("PASS: Cloudflare tokens are scoped to individual Preview verification/migration steps.");
console.log("PASS: Auth Preview deploy is manual, explicitly confirmed, and locked to the dedicated Preview ref.");
