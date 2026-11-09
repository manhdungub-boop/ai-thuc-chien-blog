import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "ai-tools-link-security-"));
try {
  const fixture = join(directory, "catalog.json");
  writeFileSync(fixture, JSON.stringify({
    tools: [
      { website: "http://[::1]/" },
      { website: "http://[fd00::1]/" },
      { website: "http://127.0.0.1/" },
      { website: "http://localhost./" }
    ]
  }));
  const run = spawnSync(process.execPath, ["scripts/check-ai-tools-links.mjs", fixture], {
    encoding: "utf8",
    timeout: 30000
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const summaryStart = run.stdout.indexOf("{");
  assert.ok(summaryStart >= 0, "link checker must emit a JSON summary");
  const summary = JSON.parse(run.stdout.slice(summaryStart));
  assert.equal(summary.checked, 4);
  assert.ok(summary.results.every(result => result.status === "invalid_or_non_public_url"),
    "IPv6 loopback, IPv6 ULA, IPv4 loopback, and DNS-resolved loopback targets must be rejected before fetch");
  console.log("PASS: catalog link checker blocks private IPv4/IPv6 literals and hostnames resolving to private addresses.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
