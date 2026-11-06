import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "production-output");
const productionOrigin = "https://ai-thuc-chien-blog.manhdungub.workers.dev";
const publicFiles = [
  "index.html", "ve-chung-toi.html", "thu-vien.html", "ngan-hang-ai.html",
  "styles.css", "script.js", "favicon.svg", "logo.svg", "robots.txt", "feed.xml", "sitemap.xml"
];
const publicDirectories = ["articles", "images", "illustrations"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of publicFiles) {
  await accessRequired(path.join(root, file));
  await cp(path.join(root, file), path.join(output, file));
}
for (const directory of publicDirectories) {
  await accessRequired(path.join(root, directory));
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
}
await mkdir(path.join(output, "data"), { recursive: true });
await cp(path.join(root, "data", "ai-tools.json"), path.join(output, "data", "ai-tools.json"));

async function accessRequired(file) {
  await stat(file);
}
async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(full));
    else if (item.isFile()) files.push(full);
  }
  return files;
}

const htmlFiles = (await walk(output)).filter(file => file.endsWith(".html"));
const articleFiles = htmlFiles.filter(file => file.includes(path.sep + "articles" + path.sep));
assert.equal(articleFiles.length, 69, "Production package must include exactly 69 articles.");
const sitemap = await readFile(path.join(output, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(match => match[1].trim());
assert.equal(sitemapUrls.length, 73, "Production sitemap must contain 73 URLs.");
assert.equal(new Set(sitemapUrls).size, 73, "Production sitemap URLs must be unique.");
const sitemapSet = new Set(sitemapUrls);
assert.ok(sitemapSet.has(productionOrigin + "/"), "Production sitemap must include the homepage.");
assert.ok(sitemapSet.has(productionOrigin + "/thu-vien.html"), "Production sitemap must include the library.");
assert.ok(sitemapSet.has(productionOrigin + "/ngan-hang-ai.html"), "Production sitemap must include the AI tools directory.");

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const relative = path.relative(output, file).split(path.sep).join("/");
  const expectedCanonical = relative === "index.html"
    ? productionOrigin + "/"
    : relative.startsWith("articles/")
      ? productionOrigin + "/" + relative.replace(/\.html$/i, "")
      : productionOrigin + "/" + relative;
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["']index,follow/i, relative + ": public page must remain indexable.");
  assert.ok(html.includes('<link rel="canonical" href="' + expectedCanonical + '">'), relative + ": canonical mismatch.");
  assert.doesNotMatch(html, /\.pages\.dev|\.vercel\.app|auth-app-preview/i, relative + ": preview host leaked into production HTML.");
  assert.doesNotMatch(html, /id=["']preview-api-guard["']|id=["']preview-interaction-guard["']/i, relative + ": preview-only guard leaked into production HTML.");
  if (relative.startsWith("articles/")) {
    assert.match(html, /<meta\s+name=["']author["']\s+content=["']DUNG - AI["']/i, relative + ": author metadata missing.");
    assert.match(html, /DUNG - AI/, relative + ": attribution missing.");
    assert.match(html, /https:\/\//, relative + ": HTTPS source/reference missing.");
    assert.ok(sitemapSet.has(expectedCanonical), relative + ": canonical missing from sitemap.");
  }
}
const catalog = JSON.parse(await readFile(path.join(output, "data", "ai-tools.json"), "utf8"));
assert.equal(catalog.tools.length, 27, "Production catalog must contain 27 reviewed tool records.");
const reviewEntries = catalog.tools.filter(tool => tool.verification_status === "needs_review");
assert.ok(reviewEntries.length >= 2, "Known catalog entries requiring review must remain visibly marked.");
assert.ok(reviewEntries.every(tool => Array.isArray(tool.official_sources) && tool.official_sources.length > 0), "Every needs_review entry must retain official source references.");
const flowise = catalog.tools.find(tool => tool.id === "flowise");
assert.equal(flowise?.status, "deprecated");
assert.equal(flowise?.verification_status, "needs_review");
assert.equal(flowise?.pricing_model, "unknown");
assert.equal(flowise?.pricing_status, "unknown");
const easyocr = catalog.tools.find(tool => tool.id === "easyocr");
assert.equal(easyocr?.status, "active");
assert.equal(easyocr?.verification_status, "needs_review");

const rootEntries = (await readdir(output)).sort();
const expectedEntries = ["articles","data","favicon.svg","feed.xml","illustrations","images","index.html","logo.svg","ngan-hang-ai.html","robots.txt","script.js","sitemap.xml","styles.css","thu-vien.html","ve-chung-toi.html"];
assert.deepEqual(rootEntries, expectedEntries, "Only explicitly approved public website files and directories may enter the production package.");
assert.deepEqual((await readdir(path.join(output, "data"))).sort(), ["ai-tools.json"], "Only the public AI tools catalog may be published from data/.");

const robots = await readFile(path.join(output, "robots.txt"), "utf8");
assert.match(robots, /User-agent:\s*\*\s*Allow:\s*\//i);
assert.match(robots, /Sitemap:\s*https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/sitemap\.xml/i);
assert.doesNotMatch(robots, /Disallow:\s*\//i);
const headers = [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: DENY",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=()",
  "  Strict-Transport-Security: max-age=31536000",
  ""
].join("\n");
await writeFile(path.join(output, "_headers"), headers);
console.log("PASS production package: 69 articles, 27 AI tools, 73 unique sitemap URLs.");
console.log("PASS DUNG - AI attribution, indexability, canonical URLs and HTTPS source checks.");
console.log("PASS Flowise sunset and EasyOCR review flags; review records retain official sources.");
console.log("PASS whitelist: internal README, CI, scripts and non-public data are excluded.");
console.log("PASS production security headers written.");
