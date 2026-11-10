import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/configure-cloudflare-worker-builds.yml", import.meta.url), "utf8");
const updater = await readFile(new URL("./configure_cloudflare_worker_builds.py", import.meta.url), "utf8");

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /test_configure_cloudflare_worker_builds\.py/);
assert.match(workflow, /test_workers_builds_workflow_guard\.mjs/);
assert.doesNotMatch(workflow, /CLOUDFLARE_WORKERS_BUILDS_API_TOKEN|secrets\.|api\.cloudflare\.com|wrangler (?:deploy|preview)|configure_cloudflare_worker_builds\.py/);
assert.match(updater, /DISABLED: Cloudflare Workers Builds changes are locked/);
assert.doesNotMatch(updater, /urllib\.request|urlopen|api\.cloudflare\.com|method=["'](?:PATCH|POST)["']/i);
console.log("PASS: Workers Builds workflow and helper are offline-only; no Cloudflare credentials or API mutations are reachable.");
