import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../staging-entrypoint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(root, "site-snapshot");
const origin = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const calls = [];
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
const env = {
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      calls.push({ method: request.method, pathname: url.pathname });
      const file = path.join(siteRoot, url.pathname.replace(/^\/+/, ""));
      try {
        const body = await readFile(file);
        const ext = path.extname(file).toLowerCase();
        return new Response(request.method === "HEAD" ? null : body, {
          status: 200,
          headers: { "Content-Type": contentTypes[ext] || "application/octet-stream" },
        });
      } catch {
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    },
  },
  // No DB binding is supplied: the API routing test must fail safely before query/write.
};

async function get(pathname, method = "GET") {
  return worker.fetch(new Request(origin + pathname, { method }), env);
}
const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
}
function assertNoindex(response, html) {
  assert.match(response.headers.get("x-robots-tag") || "", /noindex,\s*nofollow,\s*noarchive/i);
  if (html !== undefined) assert.match(html, /<meta\b(?=[^>]*name=["']robots["'])[^>]*noindex,\s*nofollow,\s*noarchive/i);
}

const sitemap = await readFile(path.join(siteRoot, "sitemap.xml"), "utf8");
const articlePaths = sitemap.split("<loc>").slice(1).map(part => part.split("</loc>")[0].trim())
  .filter(value => value.includes("/articles/"))
  .map(value => new URL(value).pathname);
check("snapshot sitemap identifies 69 unique article routes", () => assert.equal(new Set(articlePaths).size, 69));

const home = await get("/");
const homeHtml = await home.text();
check("homepage serves the local 69-article snapshot, not upstream Pages", () => {
  assert.equal(home.status, 200);
  assert.match(homeHtml, /69 bài thực hành/i);
  assert.match(homeHtml, /bao-cao-tuan-google-sheets-voi-ai/);
  assertNoindex(home, homeHtml);
});
check("homepage Organization JSON-LD uses the current staging logo URL", () => {
  const stagingLogoUrl = new URL("/logo.svg", origin).toString();
  assert.ok(homeHtml.includes(stagingLogoUrl), "Homepage JSON-LD should include " + stagingLogoUrl);
  assert.ok(!homeHtml.includes("https://ai-thuc-chien-blog.manhdungub.workers.dev/logo.svg"),
    "Homepage JSON-LD must not retain the production logo URL in staging.");
});
check("homepage has cache-safe security headers", () => {
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(home.headers.get("cache-control") || "", /no-store/);
});

const article = await get("/articles/bao-cao-tuan-google-sheets-voi-ai");
const articleHtml = await article.text();
check("weekly report article returns HTTP 200 from ASSETS", () => {
  assert.equal(article.status, 200);
  assert.match(articleHtml, /Tạo báo cáo tuần từ Google Sheets với AI có kiểm chứng/);
  assertNoindex(article, articleHtml);
});
check("weekly article author/publisher JSON-LD uses the staging logo URL", () => {
  const stagingLogoUrl = new URL("/logo.svg", origin).toString();
  assert.ok(articleHtml.includes(stagingLogoUrl), "Weekly article JSON-LD should include " + stagingLogoUrl);
  assert.ok(!articleHtml.includes("https://ai-thuc-chien-blog.manhdungub.workers.dev/logo.svg"),
    "Weekly article JSON-LD must not retain the production logo URL in staging.");
});
check("weekly report canonical remains the public production URL", () => {
  assert.match(articleHtml, /rel="canonical"\s+href="https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/articles\/bao-cao-tuan-google-sheets-voi-ai"/);
});

const headArticle = await get("/articles/bao-cao-tuan-google-sheets-voi-ai", "HEAD");
const headArticleBody = await headArticle.text();
check("article HEAD is 200 and has no body", () => {
  assert.equal(headArticle.status, 200);
  assert.equal(headArticleBody, "");
  assertNoindex(headArticle);
});

const library = await get("/thu-vien");
const libraryHtml = await library.text();
check("extensionless library route maps to thu-vien.html", () => {
  assert.equal(library.status, 200);
  assert.match(libraryHtml, /Thư viện 69 bài thực hành/);
  assertNoindex(library, libraryHtml);
});
const logo = await get("/logo.svg");
const logoBody = await logo.text();
check("512x512 organization logo serves from ASSETS", () => {
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get("content-type") || "", /image\/svg\+xml/i);
  assert.match(logoBody, /width="512"\s+height="512"/);
  assert.match(logoBody, /AI Thực Chiến/);
  assertNoindex(logo);
});

const robots = await get("/robots.txt");
const robotsText = await robots.text();
check("robots.txt lets crawlers observe noindex without advertising a sitemap", () => {
  assert.equal(robots.status, 200);
  assert.match(robotsText, /User-agent:\s*\*/i);
  assert.match(robotsText, /Allow:\s*\//i);
  assert.doesNotMatch(robotsText, /Sitemap:/i);
  assertNoindex(robots);
});
for (const route of ["/sitemap.xml", "/feed.xml", "/rss.xml"]) {
  const response = await get(route);
  check(route + " is hidden on staging", () => assert.equal(response.status, 404));
}
const unknown = await get("/articles/does-not-exist-route-xyz");
const unknownHtml = await unknown.text();
check("unknown article remains HTTP 404 and never redirects to the homepage", () => {
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get("location"), null);
  assert.match(unknownHtml, /Không tìm thấy trang/);
  assertNoindex(unknown, unknownHtml);
});

const legacy = await get("/articles/bat-dau-voi-ai.html");
check("legacy .html article path keeps the canonical 301 route", () => {
  assert.equal(legacy.status, 301);
  assert.match(legacy.headers.get("location") || "", /\/articles\/bat-dau-voi-ai(?:\?|$)/);
});

const callsBeforeApi = calls.length;
const apiResponse = await worker.fetch(new Request(origin + "/api/community/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
}), env);
check("community API requests bypass static ASSETS and fail safely without DB", () => {
  assert.equal(apiResponse.status, 503);
  assert.equal(calls.length, callsBeforeApi);
});

const beforeLogin = calls.length;
const login = await get("/login");
check("direct login route is delegated to the auth Worker", () => {
  assert.equal(login.status, 302);
  assert.match(login.headers.get("location") || "", /[?&]mode=login/);
  assert.equal(calls.length, beforeLogin);
});

console.log("PASS staging content/auth route isolation: " + checks.length + " checks; " + articlePaths.length + " article routes in source sitemap.");
console.log("Safety: local mock assets only; no live Worker, email relay, D1 query/write, secrets or production endpoint called.");
