import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const resultsDir = "test-results";
fs.mkdirSync(resultsDir, { recursive: true });
const files = fs.readdirSync("preview-output/articles")
  .filter(name => name.endsWith(".html"))
  .sort();
let browser;
try {
  assert.equal(files.length, 69, "preview must contain exactly 69 article pages");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());

  for (const file of files) {
    const relative = path.join("articles", file);
    const html = fs.readFileSync(path.join("preview-output", relative), "utf8");
    assert.match(html, /<meta name="author" content="DUNG - AI">/, relative + ": author meta");
    assert.match(html, /class="article-byline"[^>]*>[\s\S]*?DUNG - AI/, relative + ": visible byline");
    assert.match(html, /class="article-author-note"/, relative + ": attribution note");
    assert.match(html, /vui lòng ghi rõ tác giả[\s\S]*?DUNG - AI/i, relative + ": republication attribution");
    assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive">/, relative + ": preview noindex");
    assert.match(html, /<link rel="canonical" href="https:\/\/preview-editorial-e2e\.pages\.dev\//, relative + ": preview canonical");

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    assert.ok(jsonLdMatch, relative + ": JSON-LD exists");
    const jsonLd = JSON.parse(jsonLdMatch[1]);
    assert.equal(jsonLd["@type"], "BlogPosting", relative + ": JSON-LD type");
    assert.equal(jsonLd.author?.name, "DUNG - AI", relative + ": JSON-LD author");

    assert.match(html, /<figure class="article-diagram"/, relative + ": diagram figure");
    assert.match(html, /<svg[^>]+role="img"[^>]+aria-labelledby=/, relative + ": accessible SVG");
    assert.match(html, /<title id="article-diagram-title-[^"]+">/, relative + ": SVG title");
    assert.match(html, /<desc id="article-diagram-desc-[^"]+">/, relative + ": SVG description");
    assert.match(html, /<figcaption/, relative + ": diagram caption");
    assert.doesNotMatch(html, /TODO|FIXME|lorem ipsum|placeholder text|điền ngày/i, relative + ": obvious placeholders");

    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 10000 });
    assert.equal(await page.locator("h1").count(), 1, relative + ": one main heading");
    assert.equal(await page.locator(".article-byline").count(), 1, relative + ": one visible byline");
    assert.equal(await page.locator("figure.article-diagram svg").count(), 1, relative + ": one diagram SVG");
    assert.equal(await page.locator("figure.article-diagram svg title").count(), 1, relative + ": SVG title parsed");
    assert.equal(await page.locator("figure.article-diagram svg desc").count(), 1, relative + ": SVG description parsed");
    assert.equal(await page.locator(".article-author-note").count(), 1, relative + ": attribution note parsed");
  }

  console.log("PASS Chromium article smoke: all 69 pages parsed; author meta/byline/JSON-LD, attribution, accessible SVG, preview canonical/noindex and placeholder checks passed.");
  fs.writeFileSync(path.join(resultsDir, "junit.xml"),
    '<testsuites><testsuite name="editorial-browser-smoke" tests="69" failures="0"><testcase classname="articles" name="all-69-pages"/></testsuite></testsuites>');
} catch (error) {
  console.error(error);
  const escapeXml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  fs.writeFileSync(path.join(resultsDir, "junit.xml"),
    '<testsuites><testsuite name="editorial-browser-smoke" tests="1" failures="1"><testcase classname="articles" name="all-69-pages"><failure message="Editorial browser smoke failed">' + escapeXml(error.stack || error) + '</failure></testcase></testsuite></testsuites>');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
