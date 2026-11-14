import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const dist = path.join(root, "dist");
const articleDir = path.join(dist, "articles");
assert.ok(fs.existsSync(articleDir), "dist/articles must exist; run npm run build first");
const articleFiles = fs.readdirSync(articleDir).filter(file => file.endsWith(".html")).sort();
const sourceArticleFiles = fs.readdirSync(path.join(root, "articles")).filter(file => file.endsWith(".html")).sort();
assert.deepEqual(articleFiles, sourceArticleFiles, "release candidate must include every source article exactly once");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};
const server = http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (/^articles\/[a-z0-9-]+$/.test(relative)) relative += ".html";
    const target = path.resolve(dist, relative);
    if (target !== dist && !target.startsWith(dist + path.sep)) {
      res.writeHead(403); res.end("forbidden"); return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(target).pipe(res);
  } catch {
    res.writeHead(400); res.end("bad request");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    return route.continue();
  });
  let checked = 0;
  for (const file of articleFiles) {
    const slug = file.slice(0, -5);
    const response = await page.goto(`${origin}/articles/${slug}`, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `${slug}: route must return HTTP 200`);
    assert.ok(await page.title(), `${slug}: document title must not be empty`);
    assert.equal(await page.locator("h1").count(), 1, `${slug}: expected exactly one H1`);
    const related = page.locator("nav.related-articles-grid a[href^='/articles/']");
    assert.ok(await related.count() >= 3, `${slug}: at least three related links must render`);
    const hrefs = await related.evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    assert.equal(new Set(hrefs).size, hrefs.length, `${slug}: related links must be unique`);
    for (const href of hrefs) {
      const targetSlug = href.replace(/^\/articles\//, "");
      assert.ok(articleFiles.includes(targetSlug + ".html"), `${slug}: broken related link ${href}`);
    }
    checked++;
  }
  const bank = await page.goto(`${origin}/ngan-hang-ai.html`, { waitUntil: "domcontentloaded" });
  assert.equal(bank?.status(), 200, "AI Bank page must return HTTP 200");
  await page.waitForFunction(() => document.querySelectorAll(".tool-card").length > 0, { timeout: 10000 });
  assert.ok(await page.locator("#bank-search").count(), "AI Bank search control must render");
  assert.ok(await page.locator("#bank-pagination").count(), "AI Bank pagination control must render");
  console.log(`BROWSER RELEASE CHECK PASS: ${checked} article pages, related-link resolution, mobile viewport, and AI Bank catalog UI.`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
