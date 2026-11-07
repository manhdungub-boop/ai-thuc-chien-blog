import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";

assert.ok(process.env.VERCEL_URL, "VERCEL_URL must be provided by Vercel");
const result = spawnSync(process.execPath, ["scripts/build-preview.mjs"], { stdio: "inherit" });
if (result.error) throw result.error;
assert.equal(result.status, 0, "Vercel staging preview build must pass");
assert.ok((await stat("preview-output/index.html")).isFile(), "Vercel preview output must include index.html");
console.log("PASS Vercel staging preflight: noindex preview output built; no Worker deployment or production publish");
