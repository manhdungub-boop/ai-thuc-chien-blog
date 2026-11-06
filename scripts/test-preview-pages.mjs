import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const output = path.join(process.cwd(), "preview-output");
const netlifyConfig = await readFile(path.join(process.cwd(), "netlify.toml"), "utf8");
assert.match(netlifyConfig, /command\s*=\s*"node scripts\/netlify-preview-build\.mjs"/);
assert.match(netlifyConfig, /publish\s*=\s*"preview-output"/);
const netlifyBuildWrapper = await readFile(path.join(process.cwd(), "scripts", "netlify-preview-build.mjs"), "utf8");
assert.match(netlifyBuildWrapper, /process\.env\.CONTEXT/);
assert.match(netlifyBuildWrapper, /"deploy-preview"/);
assert.match(netlifyBuildWrapper, /DEPLOY_PRIME_URL/);
assert.ok((await stat(output)).isDirectory(), "Run build-main-preview.mjs first.");
const vercelConfig = JSON.parse(await readFile(path.join(process.cwd(), "vercel.json"), "utf8"));
assert.ok(
  vercelConfig.rewrites?.some(rule => rule.source === "/articles/:slug" && rule.destination === "/articles/:slug.html"),
  "Vercel preview must rewrite extensionless article URLs to the static HTML files."
);
const homepage = await readFile(path.join(output, "index.html"), "utf8");
const apiGuard = homepage.match(/<script id="preview-api-guard">([\s\S]*?)<\/script>/);
assert.ok(apiGuard, "Preview homepage must contain the API guard script.");
assert.doesNotThrow(() => new vm.Script(apiGuard[1]), "Preview API guard must be valid JavaScript.");

const htmlFiles = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full);
    else if (item.isFile() && full.endsWith(".html")) htmlFiles.push(full);
  }
}
await walk(output);
const articles = htmlFiles.filter(file => file.includes(path.sep + "articles" + path.sep));
assert.equal(articles.length, 69);
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  assert.match(html, /name=["']robots["'] content=["']noindex,nofollow,noarchive["']/i);
  assert.doesNotMatch(html, /rel=["']canonical["'][^>]*ai-thuc-chien-blog\.manhdungub\.workers\.dev/i);
  if (!file.endsWith(path.sep + "404.html")) {
    assert.ok(html.includes("preview-api-guard"));
    assert.ok(html.includes('target.pathname === "/api/community"'), "preview API guard must match the community API root");
    assert.ok(html.includes('target.pathname.startsWith("/api/community/")'), "preview API guard must match community API subpaths");
  }
}
assert.ok(!(await readdir(output)).includes("sitemap.xml"), "Preview must not publish the production sitemap.");
const robots = await readFile(path.join(output, "robots.txt"), "utf8");
assert.doesNotMatch(robots, /Sitemap:/i);
const headers = await readFile(path.join(output, "_headers"), "utf8");
assert.match(headers, /X-Robots-Tag:\s*noindex/i);
const netlifyRedirects = await readFile(path.join(output, "_redirects"), "utf8");
assert.match(netlifyRedirects, /^\/articles\/:slug\s+\/articles\/:slug\.html\s+200\s*$/m, "Netlify preview must rewrite extensionless article routes to static HTML files.");
console.log("PASS preview output is noindex, API-guarded and excludes the production sitemap.");
