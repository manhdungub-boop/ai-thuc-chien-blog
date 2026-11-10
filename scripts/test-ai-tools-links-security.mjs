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
      { website: "http://localhost./" },
      { website: "http://192.88.99.1/" }
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
  assert.equal(summary.checked, 5);
  const checkerSource = await import("node:fs/promises").then(({ readFile }) => readFile("scripts/check-ai-tools-links.mjs", "utf8"));
  assert.match(checkerSource, /maxHeaderSize:\s*64\s*\*\s*1024/,
    "Publisher response headers must use a bounded size above Node's small default.");
  assert.match(checkerSource, /\[502,503,504\]\.includes\(response\.status\)/,
    "Transient upstream server failures must receive one bounded retry.");
  assert.match(checkerSource, /attempt === 1 \? safePublicUrl\(current\.href\)/,
    "Every retry must re-resolve and re-pin the public destination.");
  assert.ok(summary.results.every(result => result.status === "invalid_or_non_public_url"),
    "IPv6 loopback, IPv6 ULA, IPv4 loopback, DNS-resolved loopback, and deprecated 6to4 relay targets must be rejected before fetch");
  console.log("PASS: catalog link checker blocks private IPv4/IPv6 literals, private DNS targets, and deprecated 6to4 relay addresses.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
