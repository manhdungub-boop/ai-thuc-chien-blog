import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../script.js", import.meta.url), "utf8");
const match = source.match(/const communityAuthHosts = new Set\\(\\[([\\s\\S]*?)\\]\\);/);
assert.ok(match, "community auth host allowlist must be declared");

test("allows the exact documented staging OAuth Worker host", () => {
  assert.match(
    match[1],
    /['"]ai-thuc-chien-blog-auth-app-preview\\.manhdungub\\.workers\\.dev['"]/,
  );
});

test("keeps the community auth allowlist explicit rather than wildcard-based", () => {
  assert.doesNotMatch(match[1], /\\*/);
});
