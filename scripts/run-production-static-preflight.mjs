import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const resultsDir = "test-results";
fs.mkdirSync(resultsDir, { recursive: true });
const steps = [
  ["build-production-static", ["scripts/build-production-static.mjs"]],
  ["test-production-static", ["scripts/test-production-static.mjs"]]
];
const results = [];
let stop = false;
for (const [name, args] of steps) {
  if (stop) {
    results.push({ name, code: 99, output: "Skipped because the build step failed." });
    continue;
  }
  const run = spawnSync("node", args, { encoding: "utf8", timeout: 120000 });
  const code = run.status === null ? 1 : run.status;
  const output = [run.stdout || "", run.stderr || "", run.error ? String(run.error) : ""].join("\n");
  fs.writeFileSync(path.join(resultsDir, name + ".log"), output);
  results.push({ name, code, output });
  console.log((code === 0 ? "PASS " : "FAIL ") + name + " (exit " + code + ")");
  console.log(output);
  if (code !== 0) stop = true;
}
const esc = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cases = results.map(x => '<testcase classname="production-static-preflight" name="' + esc(x.name) + '">' +
  (x.code === 0 ? "" : '<failure message="exit ' + x.code + '">' + esc(x.output) + "</failure>") +
  "</testcase>").join("");
const failures = results.filter(x => x.code !== 0).length;
fs.writeFileSync(path.join(resultsDir, "production-static-preflight.xml"),
  '<testsuites><testsuite name="production-static-preflight" tests="' + results.length + '" failures="' + failures + '">' + cases + "</testsuite></testsuites>");
if (failures) process.exitCode = 1;
