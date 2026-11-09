import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const workers = await read(".github/workflows/deploy-cloudflare-workers.yml");
const pages = await read(".github/workflows/deploy-cloudflare-pages.yml");
const previewD1 = await read(".github/workflows/migrate-preview-d1.yml");

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
console.log("PASS: Worker and Pages Production deploys require manual main-ref confirmation.");
console.log("PASS: Preview D1 migrations run only from reviewed main and use the fixed Preview database.");
console.log("PASS: Cloudflare tokens are scoped to the individual Preview verification/migration steps.");
