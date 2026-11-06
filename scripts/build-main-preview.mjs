import assert from "node:assert/strict";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const snapshot = path.join(root, "site-snapshot");
const existingSnapshot = await stat(snapshot).then(() => true).catch(() => false);
if (!existingSnapshot) {
  await mkdir(snapshot, { recursive: true });
  const files = ["index.html","ve-chung-toi.html","thu-vien.html","ngan-hang-ai.html","styles.css","script.js","favicon.svg","logo.svg","robots.txt","feed.xml","sitemap.xml"];
  const dirs = ["articles","images","illustrations"];
  for (const file of files) await cp(path.join(root,file),path.join(snapshot,file));
  await mkdir(path.join(snapshot,"data"),{recursive:true});
  await cp(path.join(root,"data","ai-tools.json"),path.join(snapshot,"data","ai-tools.json"));
  for (const dir of dirs) await cp(path.join(root,dir),path.join(snapshot,dir),{recursive:true});
  console.log("Prepared a whitelisted main-branch static snapshot for isolated preview.");
} else {
  assert.ok((await readdir(snapshot)).includes("index.html"), "Existing Staging snapshot must include index.html.");
}
const run = spawnSync(process.execPath, ["scripts/build-preview.mjs"], { stdio: "inherit" });
if (run.error) throw run.error;
assert.equal(run.status, 0, "Isolated preview build must pass.");
assert.ok((await stat(path.join(root,"preview-output","index.html"))).isFile(), "Preview output must include index.html.");
console.log("PASS main/Staging branch preview packaging; no production deployment.");
