import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const date = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
const asOf = `${date.year}-${date.month}-${date.day}`;

const result = spawnSync(process.execPath, [
  "scripts/audit-ai-tools-catalog.mjs",
  "data/ai-tools.json",
  "docs/reviews/ai-tools-candidates-2026-11-02.json",
  `--as-of=${asOf}`,
  "--strict",
], { encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(result.stdout);
assert.equal(report.as_of, asOf, "--as-of must use the current Vietnam-local YYYY-MM-DD value");
assert.ok(report.main_catalog.count > 0, "main catalog must contain records");
assert.ok(Array.isArray(report.strict_blockers), "strict blockers must be reported as an array");
assert.equal(report.strict_blockers.length, 0, "catalog must have no strict blockers");
assert.deepEqual(report.main_catalog.records_needing_editorial_review, [], "all active catalog records have verified editorial status; Flowise is verified deprecated and EasyOCR checkpoint scope is documented");
assert.deepEqual(report.main_catalog.verified_with_unknown_pricing, [], "unknown pricing is allowed only for verified deprecated records excluded from active listings");
console.log(`PASS: strict catalog audit uses current Asia/Ho_Chi_Minh date (${asOf})`);
