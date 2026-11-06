import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const catalog = JSON.parse(fs.readFileSync("data/ai-tools.json", "utf8"));
const page = fs.readFileSync("ngan-hang-ai.html", "utf8");
const worker = fs.readFileSync("worker.mjs", "utf8");

assert.ok(Array.isArray(catalog.tools), "catalog must contain tools array");
assert.ok(catalog.tools.length >= 1, "catalog must not be empty");

const requiredFields = [
  "id", "name", "vendor", "website", "categories", "pricing_model",
  "pricing_status", "license", "platforms", "description",
  "free_tier_summary", "official_sources", "last_verified",
  "verification_status", "status", "tags"
];
const ids = new Set();
const names = new Set();

for (const [index, tool] of catalog.tools.entries()) {
  for (const field of requiredFields) {
    assert.ok(Object.hasOwn(tool, field), `catalog[${index}] missing field: ${field}`);
  }
  assert.match(tool.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `invalid tool id: ${tool.id}`);
  assert.ok(!ids.has(tool.id), `duplicate tool id: ${tool.id}`);
  assert.ok(!names.has(tool.name.toLocaleLowerCase("vi")), `duplicate tool name: ${tool.name}`);
  ids.add(tool.id);
  names.add(tool.name.toLocaleLowerCase("vi"));

  for (const field of ["categories", "platforms", "official_sources", "tags"]) {
    assert.ok(Array.isArray(tool[field]) && tool[field].length > 0, `${tool.id}: ${field} must be a non-empty array`);
    assert.ok(tool[field].every(value => typeof value === "string" && value.trim()), `${tool.id}: ${field} contains an empty value`);
  }
  for (const source of [tool.website, ...tool.official_sources]) {
    const url = new URL(source);
    assert.equal(url.protocol, "https:", `${tool.id}: source must use HTTPS: ${source}`);
    assert.ok(url.hostname && !url.username && !url.password, `${tool.id}: invalid source URL: ${source}`);
  }
  assert.ok(Number.isFinite(Date.parse(tool.last_verified)), `${tool.id}: invalid last_verified date`);
  assert.equal(new Date(tool.last_verified).toISOString().slice(0, 10), tool.last_verified, `${tool.id}: last_verified must be YYYY-MM-DD`);
  assert.ok(["verified", "needs_review", "stale", "disputed"].includes(tool.verification_status), `${tool.id}: invalid verification_status`);
}

assert.ok(page.includes("fetch('/data/ai-tools.json'"), "AI bank page must load the JSON catalog");
assert.match(page, /const\s+PAGE_SIZE\s*=\s*24\s*;/, "AI bank page must paginate in batches of 24");
for (const id of ["bank-search", "bank-cost", "bank-license", "bank-platform", "bank-verification", "bank-sort", "bank-grid", "bank-pagination"]) {
  assert.ok(page.includes(`id="${id}"`), `missing UI control: ${id}`);
}

const inlineScripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
assert.ok(inlineScripts.length >= 1, "AI bank page must contain its catalog controller");
for (const [index, match] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new vm.Script(match[1], { filename: `ngan-hang-ai-inline-${index}.js` }), `inline script ${index} must parse`);
}
const controller = inlineScripts.map(match => match[1]).join("\n");
for (const token of ["Object.values(controls).forEach", "data-filter", "function render()", "fetch('/data/ai-tools.json'"]) {
  assert.ok(controller.includes(token), `catalog controller missing expected behavior: ${token}`);
}
assert.ok(controller.includes("textContent"), "catalog cards must render text safely");
assert.ok(worker.includes("resolveAssetRequest"), "staging Worker must resolve static assets");
assert.ok(worker.includes("env.ASSETS.fetch(resolveAssetRequest(request))", "staging Worker must serve static assets through ASSETS binding");
assert.ok(!page.includes('data-search="chatgpt openai'), "legacy hard-coded tool cards should be removed");

console.log(`AI bank UI/data contract OK: ${catalog.tools.length} catalog records; unique IDs/names; HTTPS sources; inline JavaScript parses; search/filter/sort/pagination hooks present.`);
