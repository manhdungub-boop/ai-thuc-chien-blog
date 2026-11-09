import assert from "node:assert/strict";
import { cp, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("site-snapshot");
const outputRoot = path.resolve("content-preview-assets");
assert.ok((await stat(sourceRoot)).isDirectory(), "site-snapshot must exist");
await rm(outputRoot, { recursive: true, force: true });
await cp(sourceRoot, outputRoot, { recursive: true });

await rm(path.join(outputRoot, "data", "review"), { recursive: true, force: true });
for (const file of ["sitemap.xml", "feed.xml", "rss.xml", "RECOVERY-README.txt", "_headers"]) {
  await rm(path.join(outputRoot, file), { force: true });
}
async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...await walk(full));
    else if (item.isFile()) files.push(full);
  }
  return files;
}
const files = await walk(outputRoot);
const articles = files.filter(file => file.includes(path.sep + "articles" + path.sep) && file.endsWith(".html"));
assert.equal(articles.length, 69, "sanitized preview must retain all 69 articles");
assert.ok(files.some(file => file.endsWith(path.sep + "index.html")), "sanitized preview must retain homepage");
assert.ok(files.some(file => file.endsWith(path.sep + "data" + path.sep + "ai-tools.json")), "sanitized preview must retain public AI catalog");
assert.equal(files.some(file => file.includes(path.sep + "data" + path.sep + "review" + path.sep)), false, "internal review files must not be included");
assert.equal(files.some(file => /(?:^|[\\/])(?:sitemap\.xml|feed\.xml|rss\.xml|RECOVERY-README\.txt|_headers)$/.test(file)), false, "preview must not include blocked metadata or internal files");
console.log("PASS sanitized content preview assets: " + files.length + " files; 69 articles; public AI catalog retained; internal review data and sitemap/feed excluded.");
