import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, [
  "scripts/audit-ai-tools-catalog.mjs",
  "data/ai-tools.json",
  "docs/reviews/ai-tools-candidates-2026-11-02.json",
  "--as-of=2026-11-08",
  "--strict",
], { encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(result.stdout);
assert.equal(report.as_of, "2026-11-08", "--as-of must preserve the complete YYYY-MM-DD value");
assert.ok(report.main_catalog.count > 0, "main catalog must contain records");
assert.ok(Array.isArray(report.strict_blockers), "strict blockers must be reported as an array");
assert.equal(report.strict_blockers.length, 0, "catalog must have no strict blockers");
console.log("PASS: explicit --as-of parsing and strict catalog audit");
