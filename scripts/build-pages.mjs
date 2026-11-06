import assert from "node:assert/strict";
import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const branch = process.env.CF_PAGES_BRANCH || process.env.CI_COMMIT_BRANCH || "main";
const root = process.cwd();
const run = (script) => {
  const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, script + " must pass.");
};
const output = path.join(root, "dist");
await rm(output, { recursive: true, force: true });
if (branch === "main") {
  run("scripts/build-production-pages.mjs");
  await cp(path.join(root, "production-output"), output, { recursive: true });
  console.log("PASS production Pages package selected for main.");
} else {
  run("scripts/build-main-preview.mjs");
  await cp(path.join(root, "preview-output"), output, { recursive: true });
  console.log("PASS noindex preview package selected for branch " + branch + ".");
}
assert.ok((await stat(path.join(output, "index.html"))).isFile(), "Cloudflare Pages dist output must include index.html.");
