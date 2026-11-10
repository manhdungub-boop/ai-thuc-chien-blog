import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const pagePath = "preview-output/ngan-hang-ai.html";
const catalogPath = "preview-output/data/ai-tools.json";
const html = fs.readFileSync(pagePath, "utf8");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const activeTools = catalog.tools.filter(t => t && t.status === "active");
const needsReview = catalog.tools.filter(t => t.verification_status === "needs_review");
const activeNeedsReview = activeTools.filter(t => t.verification_status === "needs_review");
const newIds = ["anythingllm", "opencode", "comfyui", "qdrant", "whisper-cpp", "mlflow", "pydantic-ai", "haystack", "elevenlabs"];

assert.equal(catalog.tools.length, 36, "catalog must contain 36 total records after the verified ElevenLabs addition");
assert.equal(activeTools.length, 35, "public AI Bank must show 35 active records; deprecated Flowise stays hidden");
assert.deepEqual(needsReview.map(t => t.id).sort(), ["easyocr"], "only EasyOCR remains under editorial review");
assert.equal(activeNeedsReview.length, 1, "only active EasyOCR should appear in the needs-review filter");
for (const id of newIds) {
  const tool = catalog.tools.find(t => t.id === id);
  assert.equal(tool?.status, "active", `${id} must be active`);
  assert.equal(tool?.verification_status, "verified", `${id} must pass editorial/source review`);
}
const flowise = catalog.tools.find(t => t.id === "flowise");
assert.equal(flowise?.status, "deprecated", "Flowise must remain marked deprecated after its official sunset");
assert.equal(flowise?.pricing_model, "unknown", "Flowise pricing model must not be inferred after sunset");
assert.equal(flowise?.pricing_status, "unknown", "Flowise Cloud pricing must remain unverified");
assert.equal(flowise?.verification_status, "verified", "Flowise sunset facts must be verified even though the tool is deprecated");
assert.equal(catalog.tools.find(t => t.id === "notebooklm")?.name, "NotebookLM", "NotebookLM must keep its canonical ID and name");
assert.ok(!catalog.tools.some(t => t.id === "gemini-notebook"), "legacy Gemini Notebook ID must not return");
assert.ok(!fs.existsSync("preview-output/data/review"), "candidate review data must not be public in preview");
assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive">/, "preview HTML must be noindex");
assert.match(fs.readFileSync("preview-output/_headers", "utf8"), /X-Robots-Tag:\s*noindex,\s*nofollow,\s*noarchive/i, "preview response headers must be noindex");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (["/", "/ngan-hang-ai", "/ngan-hang-ai.html"].includes(url.pathname)) {
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    }
    if (url.pathname === "/data/ai-tools.json") {
      return route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(catalog) });
    }
    return route.fulfill({ status: 404, body: "not found" });
  });

  await page.goto("http://127.0.0.1/ngan-hang-ai");
  await page.waitForFunction(count => document.querySelector("#bank-count")?.textContent.includes(` / ${count} công cụ`), activeTools.length);
  await page.waitForFunction(total => document.querySelector("#bank-count")?.textContent.includes(`Tổng danh mục: ${total}.`), activeTools.length);
  const cards = page.locator("#bank-grid .tool-card");
  assert.equal(await cards.count(), 24, "first page must show 24 active cards");
  assert.match(await page.locator("#bank-pagination").innerText(), /Trang 1 \/ 2/);

  for (const name of ["Langfuse", "NotebookLM", "AnythingLLM", "OpenCode", "ComfyUI", "Qdrant", "whisper.cpp", "MLflow", "Pydantic AI", "Haystack", "ElevenLabs"]) {
    await page.locator("#bank-search").fill(name);
    await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 1);
    assert.ok((await page.locator("#bank-grid").innerText()).toLocaleLowerCase("vi").includes(name.toLocaleLowerCase("vi")), `${name} must be searchable`);
  }

  await page.locator("#bank-search").fill("");
  await page.locator("#bank-sort").selectOption("name");
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 24);
  assert.match(await page.locator("#bank-grid .tool-card h2").first().innerText(), /^Activepieces$/);

  await page.locator("#bank-pagination button").last().click();
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 10);
  assert.match(await page.locator("#bank-pagination").innerText(), /Trang 2 \/ 2/);
  await page.locator("#bank-pagination button").first().click();
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 24);

  await page.locator("#bank-verification").selectOption("needs_review");
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 1);
  const reviewText = await page.locator("#bank-grid").innerText();
  assert.ok(reviewText.includes("EasyOCR"), "active needs_review filter must include EasyOCR");
  assert.ok(!reviewText.includes("Flowise"), "deprecated Flowise must stay hidden from public active results");

  console.log("PASS Chromium catalog E2E: 36 total records / 35 active; 24+10 pagination; search across 8 additions; canonical IDs; A-Z sort; accurate review filter; Preview noindex and candidate isolation.");
} finally {
  await browser.close();
}
