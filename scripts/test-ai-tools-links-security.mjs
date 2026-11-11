import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  assert.match(checkerSource, /attempt === 0 \? safe : await safePublicUrl\(current\.href\)/,
    "Every retry must re-resolve and re-pin the public destination.");
  assert.match(checkerSource, /manuallyVerifiedOfficialUrls\.has\(original\)/,
    "Only exact, manually reviewed publisher URLs may bypass automated 403/404 probe ambiguity.");
  assert.ok(checkerSource.includes('"https://www.perplexity.ai/enterprise/pricing"'),
    "The exact official Perplexity pricing URL must be recorded for manual verification.");
  assert.ok(checkerSource.includes('"https://github.com/ollama/ollama/blob/main/LICENSE"'),
    "The exact GitHub license page verified through the repository API must be recorded.");
  assert.match(checkerSource, /\[401,403,405,429,502,503,504\]\.includes\(code\)/,
    "Only exact manually verified URLs may be classified as manual after blocked or transient HTTP responses.");
  assert.ok(summary.results.every(result => result.status === "invalid_or_non_public_url"),
    "IPv6 loopback, IPv6 ULA, IPv4 loopback, DNS-resolved loopback, and deprecated 6to4 relay targets must be rejected before fetch");

  // Simulate DNS rebinding between validation and socket creation. The first DNS
  // answer is public; every later answer is loopback. The HTTP transport is stubbed,
  // but it invokes the exact lookup callback Node's socket layer receives.
  const rebindFixture = join(directory, "rebind-catalog.json");
  const preload = join(directory, "rebind-preload.mjs");
  const rebindResult = join(directory, "rebind-result.json");
  writeFileSync(rebindFixture, JSON.stringify({ tools: [{ website: "https://rebind.example.test/" }] }));
  writeFileSync(preload, `
    import dns from "node:dns/promises";
    import http from "node:http";
    import https from "node:https";
    import { EventEmitter } from "node:events";
    import { writeFileSync } from "node:fs";
    let dnsCalls = 0;
    const socketAddresses = [];
    dns.lookup = async () => {
      dnsCalls += 1;
      return [{ address: dnsCalls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    };
    const fakeRequest = (options, callback) => {
      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.end = () => {
        const finish = (address) => {
          socketAddresses.push(address);
          const response = new EventEmitter();
          response.statusCode = 200;
          response.headers = {};
          response.destroy = () => {};
          callback(response);
        };
        if (typeof options.lookup === "function") {
          options.lookup(options.hostname, { all: true }, (error, addresses) => {
            if (error) { req.emit("error", error); return; }
            finish(Array.isArray(addresses) ? addresses[0].address : addresses);
          });
        } else {
          dns.lookup(options.hostname).then(rows => finish(rows[0].address), error => req.emit("error", error));
        }
      };
      return req;
    };
    http.request = fakeRequest;
    https.request = fakeRequest;
    process.on("exit", () => writeFileSync(process.env.REBIND_RESULT, JSON.stringify({ dnsCalls, socketAddresses })));
  `);
  const rebindRun = spawnSync(process.execPath, ["--import", preload, "scripts/check-ai-tools-links.mjs", rebindFixture], {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, REBIND_RESULT: rebindResult }
  });
  assert.equal(rebindRun.status, 0, rebindRun.stderr || rebindRun.stdout);
  const rebindSummary = JSON.parse(rebindRun.stdout.slice(rebindRun.stdout.indexOf("{")));
  const rebindEvidence = JSON.parse(readFileSync(rebindResult, "utf8"));
  assert.equal(rebindSummary.results[0].status, "reachable");
  assert.equal(rebindEvidence.dnsCalls, 1, "the socket must not perform a second hostname resolution");
  assert.deepEqual(rebindEvidence.socketAddresses, ["93.184.216.34"],
    "the socket must connect only to the previously validated public IP, never the rebound loopback IP");
  console.log("PASS: catalog link checker blocks private targets and pins the validated public DNS answer at socket creation.");

} finally {
  rmSync(directory, { recursive: true, force: true });
}
