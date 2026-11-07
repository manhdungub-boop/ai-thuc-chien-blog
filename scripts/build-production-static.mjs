import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "site-snapshot");
const output = path.join(root, "production-output");
const productionOrigin = "https://ai-thuc-chien-blog.manhdungub.workers.dev";

assert.ok((await stat(source)).isDirectory(), "site-snapshot source must exist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

// Internal review and recovery material must never be part of a public release.
await rm(path.join(output, "data", "review"), { recursive: true, force: true });
await rm(path.join(output, "RECOVERY-README.txt"), { force: true });
await rm(path.join(output, "_headers"), { force: true });

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
assert.equal(articleFiles.length, 69, "production bundle must include exactly 69 article pages");

const catalogPath = path.join(output, "data", "ai-tools.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
assert.equal(catalog.tools.length, 27, "production bundle must include 27 catalog records");

const securityHeaders = [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  X-Frame-Options: DENY",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=()",
  "  Strict-Transport-Security: max-age=31536000",
  ""
].join("\n");
await writeFile(path.join(output, "_headers"), securityHeaders);

let articleCount = 0;
for (const file of htmlFiles) {
  let html = await readFile(file, "utf8");
  const relative = path.relative(output, file).split(path.sep).join("/");
  const expectedCanonical = relative === "index.html"
    ? productionOrigin + "/"
    : relative.startsWith("articles/")
      ? productionOrigin + "/" + relative.replace(/\.html$/i, "")
      : productionOrigin + "/" + relative;

  const robotsPattern = /<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*>/i;
  const robotsTag = '<meta name="robots" content="index,follow,max-image-preview:large">';
  if (robotsPattern.test(html)) html = html.replace(robotsPattern, robotsTag);
  else html = html.replace(/<\/head>/i, "  " + robotsTag + "\n</head>");

  const canonicalPattern = /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i;
  const canonicalTag = '<link rel="canonical" href="' + expectedCanonical + '">';
  if (canonicalPattern.test(html)) html = html.replace(canonicalPattern, canonicalTag);
  else html = html.replace(/<\/head>/i, "  " + canonicalTag + "\n</head>");

  const ogPattern = /<meta\b(?=[^>]*\bproperty\s*=\s*["']og:url["'])[^>]*>/i;
  const ogTag = '<meta property="og:url" content="' + expectedCanonical + '">';
  if (ogPattern.test(html)) html = html.replace(ogPattern, ogTag);

  const twitterPattern = /<meta\b(?=[^>]*\bname\s*=\s*["']twitter:url["'])[^>]*>/i;
  const twitterTag = '<meta name="twitter:url" content="' + expectedCanonical + '">';
  if (twitterPattern.test(html)) html = html.replace(twitterPattern, twitterTag);

  const robotsMetaElement = html.match(/<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*>/i)?.[0] || "";
  assert.ok(robotsMetaElement, "public HTML must have a robots meta tag: " + relative);
  assert.doesNotMatch(robotsMetaElement, /noindex/i, "public HTML must be indexable: " + relative);
  assert.doesNotMatch(html, /id=["']preview-api-guard["']|id=["']preview-interaction-guard["']/i,
    "public HTML must not contain preview-only API/interaction guards: " + relative);
  assert.ok(html.includes(expectedCanonical), "canonical must match the production route: " + relative);
  const metadata = [
    ...html.matchAll(/<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/gi),
    ...html.matchAll(/<meta\b(?=[^>]*\bproperty\s*=\s*["']og:url["'])[^>]*>/gi),
    ...html.matchAll(/<meta\b(?=[^>]*\bname\s*=\s*["']twitter:url["'])[^>]*>/gi),
    ...html.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi)
  ].map(match => match[0]).join("\n");
  assert.doesNotMatch(metadata, /\.pages\.dev|ai-thuc-chien-blog-auth-app-preview\.manhdungub\.workers\.dev/i,
    "public SEO metadata must not point to preview hosts: " + relative);

  if (relative.startsWith("articles/")) {
    articleCount++;
    assert.match(html, /<meta\s+name=["']author["']\s+content=["']DUNG - AI["']/i,
      "article author meta must be DUNG - AI: " + relative);
    assert.match(html, /DUNG - AI/, "article must show the DUNG - AI attribution: " + relative);
    assert.match(html, /https:\/\//, "article must contain at least one HTTPS source/reference: " + relative);
  }
  await writeFile(file, html);
}
assert.equal(articleCount, 69);

const robotsPath = path.join(output, "robots.txt");
let robots = await readFile(robotsPath, "utf8");
assert.match(robots, /User-agent:\s*\*\s*Allow:\s*\//i);
assert.match(robots, /Sitemap:\s*https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/sitemap\.xml/i);
assert.doesNotMatch(robots, /Disallow:\s*\//i);

const sitemap = await readFile(path.join(output, "sitemap.xml"), "utf8");
assert.equal((sitemap.match(/<url>/g) || []).length, 73, "sitemap must contain the 69 articles and four public pages");
assert.ok(sitemap.includes(productionOrigin), "sitemap must use production canonical URLs");
assert.doesNotMatch(sitemap, /pages\.dev|auth-app-preview/i);

await assert.rejects(stat(path.join(output, "data", "review")), "review candidate data must be excluded");
await assert.rejects(stat(path.join(output, "RECOVERY-README.txt")), "recovery notes must be excluded");
console.log("PASS production static bundle: 69 articles, 27 catalog tools, 73 sitemap URLs");
console.log("PASS production indexability, canonical/OG URLs, robots.txt and security headers");
console.log("PASS no preview hosts, noindex guards, candidate-review data or recovery notes");
