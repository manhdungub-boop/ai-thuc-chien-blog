import assert from "node:assert/strict";
import worker from "../preview-content-worker.mjs";
const calls = [];
const files = new Map([
  ["/index.html", { body: '<!doctype html><html><head><meta name="robots" content="index,follow"><title>Home</title></head><body>Home</body></html>', type: "text/html" }],
  ["/articles/mcp-filesystem-server-an-toan.html", { body: '<!doctype html><html><head><title>MCP</title></head><body>Article</body></html>', type: "text/html" }],
]);
const env = { ASSETS: { async fetch(request) {
  const url = new URL(request.url); calls.push({ path: url.pathname, method: request.method });
  const item = files.get(url.pathname);
  return item ? new Response(request.method === "HEAD" ? null : item.body, { headers: { "Content-Type": item.type, ETag: '"old"', "Cache-Control": "public, max-age=86400" } }) : new Response("Not found", { status: 404 });
} } };
const req = (path, method = "GET") => new Request("https://preview.example" + path, { method });
const home = await worker.fetch(req("/"), env);
assert.equal(home.status, 200);
assert.equal(home.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
assert.match(home.headers.get("cache-control"), /no-store/);
assert.equal(home.headers.get("etag"), null);
assert.match(await home.text(), /noindex, nofollow, noarchive/);
const article = await worker.fetch(req("/articles/mcp-filesystem-server-an-toan"), env);
assert.equal(article.status, 200);
assert.ok(calls.some(x => x.path === "/articles/mcp-filesystem-server-an-toan.html"));
for (const path of ["/sitemap.xml", "/feed.xml", "/rss.xml"]) assert.equal((await worker.fetch(req(path), env)).status, 404);
for (const path of ["/data/review", "/data/review/", "/data/review/ai-tools-candidates.json", "/data%2Freview%2Fai-tools-candidates.json"]) {
  const before = calls.length;
  assert.equal((await worker.fetch(req(path), env)).status, 404, "internal review data must not be served: " + path);
  assert.equal(calls.length, before, "blocked review paths must not reach ASSETS: " + path);
}
for (const path of ["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"]) {
  const before = calls.length;
  const response = await worker.fetch(req(path), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /không được bật trên bản xem trước/i);
  assert.equal(calls.length, before);
}
const post = await worker.fetch(req("/register", "POST"), env);
assert.equal(post.status, 405);
assert.equal(calls.some(x => x.method === "POST"), false);
console.log("PASS isolated preview policy: noindex/no-store, review-data isolation, metadata/auth isolation, GET/HEAD only, ASSETS-only mock.");
