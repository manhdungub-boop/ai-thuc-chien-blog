import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const pagePath = "preview-output/ngan-hang-ai.html";
const catalogPath = "preview-output/data/ai-tools.json";
const html = fs.readFileSync(pagePath, "utf8");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

assert.equal(catalog.tools.length, 27, "staging catalog must contain 27 records");
const flowise = catalog.tools.find(t => t.id === "flowise");
assert.equal(flowise?.status, "deprecated", "Flowise must remain marked deprecated after its official sunset");
assert.equal(flowise?.pricing_model, "unknown", "Flowise pricing model must not be inferred after sunset");
assert.equal(flowise?.pricing_status, "unknown", "Flowise Cloud pricing must remain unverified");
assert.equal(flowise?.verification_status, "needs_review", "Flowise must remain in editorial review after sunset");
assert.equal(catalog.tools.filter(t => t.verification_status === "needs_review").length, 4,
  "catalog must retain Adobe Firefly plus Flowise, EasyOCR and Hugging Face Hub as needs_review records");
assert.equal(catalog.tools.find(t => t.id === "notebooklm")?.name, "NotebookLM",
  "NotebookLM must keep its canonical ID and name");
assert.ok(!catalog.tools.some(t => t.id === "gemini-notebook"), "legacy Gemini Notebook ID must not return");
assert.ok(!fs.existsSync("preview-output/data/review"), "candidate review data must not be public in preview");
assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive">/,
  "preview HTML must be noindex");
assert.match(fs.readFileSync("preview-output/_headers", "utf8"),
  /X-Robots-Tag:\s*noindex,\s*nofollow,\s*noarchive/i,
  "preview response headers must be noindex");

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
      return route.fulfill({ status: 200, contentType: "application/json; charset=utf-8",
        body: JSON.stringify(catalog) });
    }
    return route.fulfill({ status: 404, body: "not found" });
  });

  await page.goto("http://127.0.0.1/ngan-hang-ai");
  await page.waitForFunction(() => document.querySelector("#bank-count")?.textContent.includes("27 công cụ"));
  const cards = page.locator("#bank-grid .tool-card");
  assert.equal(await cards.count(), 24, "first page must show 24 cards");
  assert.match(await page.locator("#bank-pagination").innerText(), /Trang 1 \/ 2/);

  await page.locator("#bank-search").fill("Langfuse");
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 1);
  assert.match(await page.locator("#bank-grid").innerText(), /Langfuse/);

  await page.locator("#bank-search").fill("NotebookLM");
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 1);
  assert.equal(await page.locator("#bank-grid .tool-card").getAttribute("data-id"), "notebooklm");

  await page.locator("#bank-search").fill("");
  await page.locator("#bank-sort").selectOption("name");
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 24);
  assert.match(await page.locator("#bank-grid .tool-card h2").first().innerText(), /^Activepieces$/);

  await page.locator("#bank-pagination button").last().click();
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 3);
  assert.match(await page.locator("#bank-pagination").innerText(), /Trang 2 \/ 2/);
  await page.locator("#bank-pagination button").first().click();
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 24);

  await page.locator("#bank-verification").selectOption("needs_review");
  await page.waitForFunction(() => document.querySelectorAll("#bank-grid .tool-card").length === 4);
  const reviewText = await page.locator("#bank-grid").innerText();
  for (const name of ["Adobe Firefly", "Flowise", "EasyOCR", "Hugging Face Hub"]) {
    assert.ok(reviewText.includes(name), "needs_review filter must include " + name);
  }

  console.log("PASS Chromium catalog E2E: 27 records; 24-item pagination; search; NotebookLM canonical ID; A-Z sort; needs_review filter; preview noindex and candidate isolation.");
} finally {
  await browser.close();
}
