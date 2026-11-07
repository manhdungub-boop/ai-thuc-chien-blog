import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const outDir = "test-results";
fs.mkdirSync(outDir, { recursive: true });
const tasks = [];
tasks.push({ name: "copy-and-check-apps-script", command: "bash", args: ["-lc", "cp email-relay/Code.gs /tmp/email-relay.js && node --check /tmp/email-relay.js"] });
const syntaxFiles = [
  "recovery-snapshots/worker.mjs",
  "recovery-snapshots/worker-email-verification-candidate.mjs",
  "recovery-snapshots/auth-app-preview.mjs",
  "recovery-snapshots/auth-preview.mjs",
  "staging-entrypoint.mjs",
  "site-snapshot/script.js",
  "scripts/test-route-resolution.mjs",
  "scripts/test-preview-content-worker.mjs",
  "scripts/verify-recovery.mjs",
  "scripts/verify-static-snapshot.mjs",
  "scripts/verify-article-diagrams.mjs",
  "scripts/verify-article-attribution.mjs",
  "scripts/verify-email-verification-candidate.mjs",
  "scripts/test-worker-email-verification.mjs",
  "scripts/test-worker-email-verification-boundaries.mjs",
  "scripts/test-email-relay.mjs",
  "scripts/test-password-reset.mjs",
  "scripts/test-social-auth.mjs",
  "scripts/test-staging-api-origin.mjs",
  "scripts/test-live-staging-assets.mjs",
  "scripts/test-organization-logo-rewrite.mjs",
  "scripts/test-staging-content-routing.mjs",
  "scripts/verify-staging-config.mjs",
  "scripts/verify-staging-build-config.mjs",
  "scripts/verify-release-safety.mjs",
  "scripts/validate-ai-tools-catalog.mjs",
  "scripts/test-ai-tools-catalog-ui.mjs",
  "scripts/audit-ai-tools-catalog.mjs"
];
for (const file of syntaxFiles) tasks.push({ name: "syntax-" + path.basename(file).replace(/[^a-z0-9]+/gi, "-"), command: "node", args: ["--check", file] });
const nodeTests = [
  "scripts/test-preview-content-worker.mjs",
  "scripts/test-route-resolution.mjs",
  "scripts/verify-recovery.mjs",
  "scripts/verify-static-snapshot.mjs",
  "scripts/verify-article-diagrams.mjs",
  "scripts/verify-article-attribution.mjs",
  "scripts/verify-email-verification-candidate.mjs",
  "scripts/test-worker-email-verification.mjs",
  "scripts/test-worker-email-verification-boundaries.mjs",
  "scripts/test-email-relay.mjs",
  "scripts/test-password-reset.mjs",
  "scripts/test-social-auth.mjs",
  "scripts/test-staging-api-origin.mjs",
  "scripts/test-organization-logo-rewrite.mjs",
  "scripts/test-staging-content-routing.mjs",
  "scripts/verify-staging-config.mjs",
  "scripts/verify-staging-build-config.mjs",
  "scripts/verify-release-safety.mjs",
  "scripts/validate-ai-tools-catalog.mjs",
  "scripts/test-ai-tools-catalog-ui.mjs",
  "scripts/audit-ai-tools-catalog.mjs",
  "scripts/check-ai-tools-links.mjs"
];
for (const file of nodeTests) tasks.push({
  name: "test-" + path.basename(file, ".mjs").replace(/[^a-z0-9]+/gi, "-"),
  command: "node",
  args: file === "scripts/audit-ai-tools-catalog.mjs" ? [file, "--strict"] : [file]
});
const results = [];
for (const task of tasks) {
  const run = spawnSync(task.command, task.args, { encoding: "utf8", timeout: 120000 });
  const code = run.status === null ? (run.error ? 1 : 1) : run.status;
  const output = [run.stdout || "", run.stderr || "", run.error ? String(run.error) : ""].join("\n");
  fs.writeFileSync(path.join(outDir, task.name + ".log"), output);
  results.push({ name: task.name, code, output });
  console.log((code === 0 ? "PASS " : "FAIL ") + task.name + " (exit " + code + ")");
  if (code !== 0) console.log(output.slice(-6000));
}
const failures = results.filter(x => x.code !== 0);
const esc = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cases = results.map(x => '<testcase classname="node-offline-suite" name="' + esc(x.name) + '">' +
  (x.code === 0 ? "" : '<failure message="exit ' + x.code + '">' + esc(x.output) + "</failure>") +
  "</testcase>").join("");
fs.writeFileSync(path.join(outDir, "node-offline-suite.xml"),
  '<testsuites><testsuite name="node-offline-suite" tests="' + results.length + '" failures="' + failures.length + '">' + cases + "</testsuite></testsuites>");
console.log("SUMMARY: " + (results.length - failures.length) + "/" + results.length + " passed; " + failures.length + " failed.");
if (failures.length) process.exitCode = 1;
