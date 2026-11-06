import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// This repository is connected to Netlify only for isolated Merge Request previews.
// Fail closed for production and branch-deploy contexts before creating any output.
assert.equal(
  process.env.CONTEXT,
  "deploy-preview",
  "AI Thuc Chien Netlify is preview-only; production and branch deployments are blocked."
);
assert.ok(process.env.DEPLOY_PRIME_URL, "Netlify Deploy Preview must provide DEPLOY_PRIME_URL.");

const run = spawnSync(process.execPath, ["scripts/build-main-preview.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (run.error) throw run.error;
assert.equal(run.status, 0, "Isolated Netlify Deploy Preview build must pass.");
console.log("PASS Netlify Deploy Preview only; production and branch deploy contexts are blocked.");
