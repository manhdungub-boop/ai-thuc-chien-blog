import assert from "node:assert/strict";

const origin = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const statusUrl = new URL("/__staging/status", origin);

assert.equal(statusUrl.origin, origin, "Health check must target the isolated staging Worker.");
assert.equal(statusUrl.pathname, "/__staging/status", "Only the read-only staging status endpoint may be called.");
assert.equal(statusUrl.search, "", "Health check must not send query parameters.");

async function request(path, method = "GET") {
  return fetch(new URL(path, origin), {
    method,
    redirect: "manual",
    headers: { Accept: "text/html,application/json,*/*", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(12000),
  });
}

const response = await request("/__staging/status");
assert.equal(response.status, 200, "Staging status endpoint returned HTTP " + response.status + ".");
assert.match(response.headers.get("content-type") || "", /application\/json/i,
  "Staging status endpoint must return JSON.");

const payload = await response.json();
assert.equal(payload.ok, true, "Staging status confirms database/schema readiness.");
assert.equal(payload.environment, "staging", "Refuse a response that does not identify staging.");
for (const field of ["database_ready", "schema_ready", "email_sending_enabled", "registration_ready"]) {
  assert.equal(payload[field], true, "Staging readiness field " + field + " must be true.");
}
console.log("PASS read-only staging status (database, schema, email relay configuration, registration readiness).");

const expectedStagingLogoUrl = new URL("/logo.svg", origin).toString();
const productionLogoUrl = "https://ai-thuc-chien-blog.manhdungub.workers.dev/logo.svg";
let home;
let homeHtml = "";
for (let attempt = 1; attempt <= 30; attempt++) {
  home = await request("/");
  homeHtml = await home.text();
  if (home.status === 200 && homeHtml.includes(expectedStagingLogoUrl) && !homeHtml.includes(productionLogoUrl)) break;
  if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(home.status, 200, "Staging homepage returned HTTP " + home.status + ".");
assert.match(home.headers.get("content-type") || "", /text\/html/i, "Homepage must return HTML.");
assert.match(home.headers.get("x-robots-tag") || "", /noindex/i, "Staging homepage must be noindex.");
assert.match(home.headers.get("cache-control") || "", /no-store/i, "Staging homepage must not be cached.");
assert.ok(homeHtml.includes(expectedStagingLogoUrl),
  "Waited for deployment, but homepage JSON-LD still lacks the active staging logo URL.");
assert.ok(!homeHtml.includes(productionLogoUrl),
  "Staging homepage JSON-LD still references the production logo URL.");
assert.match(homeHtml, /<meta\s+name="robots"\s+content="noindex, nofollow, noarchive"/i,
  "Staging homepage HTML must explicitly declare noindex.");
console.log("PASS staging homepage status, noindex/no-store, and current-host JSON-LD logo after deployment.");

const weekly = await request("/articles/bao-cao-tuan-google-sheets-voi-ai");
assert.equal(weekly.status, 200, "Staging weekly report returned HTTP " + weekly.status + ".");
assert.match(weekly.headers.get("x-robots-tag") || "", /noindex/i, "Staging weekly report must be noindex.");
const weeklyHtml = await weekly.text();
assert.match(weeklyHtml, /Tạo báo cáo tuần từ Google Sheets với AI có kiểm chứng/);
assert.ok(weeklyHtml.includes(expectedStagingLogoUrl), "Weekly article JSON-LD must use the current staging logo URL.");
assert.ok(!weeklyHtml.includes(productionLogoUrl), "Staging weekly article must not reference the production logo URL.");
console.log("PASS live weekly article route and JSON-LD logo.");

const library = await request("/thu-vien");
assert.equal(library.status, 200, "Staging library returned HTTP " + library.status + ".");
const libraryHtml = await library.text();
assert.match(libraryHtml, /Thư viện \d+ bài thực hành/);
assert.match(library.headers.get("x-robots-tag") || "", /noindex/i);
console.log("PASS live staging library route structure and noindex.");

const mcpArticle = await request("/articles/mcp-filesystem-server-an-toan");
assert.equal(mcpArticle.status, 200, "MCP Filesystem safety article must return HTTP 200.");
assert.match(mcpArticle.headers.get("content-type") || "", /text\/html/i);
assert.match(mcpArticle.headers.get("x-robots-tag") || "", /noindex/i);
assert.match(mcpArticle.headers.get("cache-control") || "", /no-store/i);
const mcpHtml = await mcpArticle.text();
assert.match(mcpHtml, /MCP Filesystem Server an toàn/i);
assert.match(mcpHtml, /<meta name="author" content="DUNG - AI">/i);
assert.match(mcpHtml, /class="article-byline"[^>]*>[\s\S]*?DUNG - AI/i);
assert.match(mcpHtml, /rel="canonical"\s+href="https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/articles\/mcp-filesystem-server-an-toan"/i);
assert.match(mcpHtml, /class="article-author-note"/i);
const mcpJsonLdMatch = mcpHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
assert.ok(mcpJsonLdMatch, "MCP article must contain BlogPosting JSON-LD.");
const mcpJsonLd = JSON.parse(mcpJsonLdMatch[1]);
assert.equal(mcpJsonLd.author?.name, "DUNG - AI");
assert.match(mcpHtml, /<figure class="article-diagram"/i);
console.log("PASS live MCP article route, author, canonical, JSON-LD, diagram and noindex/no-store.");

for (const route of ["/sitemap.xml", "/feed.xml"]) {
  const hidden = await request(route);
  assert.equal(hidden.status, 404, "Staging must hide " + route + ".");
}
console.log("PASS staging hides sitemap.xml and feed.xml.");

const logo = await request("/logo.svg");
assert.equal(logo.status, 200, "Staging organization logo returned HTTP " + logo.status + ".");
assert.match(logo.headers.get("content-type") || "", /image\/svg\+xml/i);
const logoHtml = await logo.text();
assert.match(logoHtml, /<svg\b/i);
assert.match(logoHtml, /width="512"\s+height="512"/i);
console.log("PASS live 512x512 staging logo response.");

const robots = await request("/robots.txt");
assert.equal(robots.status, 200, "Staging robots.txt returned HTTP " + robots.status + ".");
const robotsText = await robots.text();
assert.match(robotsText, /User-agent:\s*\*\s*Allow:\s*\//i,
  "Staging robots.txt must let crawlers observe the page-level noindex signal.");
assert.doesNotMatch(robotsText, /Disallow:\s*\//i,
  "Staging robots.txt must not block crawlers from seeing noindex.");
console.log("PASS staging robots.txt allows crawler access to the noindex signal.");

const knownArticle = await request("/articles/bat-dau-voi-ai");
assert.equal(knownArticle.status, 200, "Known staging article returned HTTP " + knownArticle.status + ".");
assert.match(knownArticle.headers.get("content-type") || "", /text\/html/i, "Known article must return HTML.");
assert.match(knownArticle.headers.get("x-robots-tag") || "", /noindex/i, "Staging articles must be noindex.");
const knownArticleHtml = await knownArticle.text();
assert.match(knownArticleHtml, /<meta\s+name="robots"\s+content="noindex, nofollow, noarchive"/i,
  "Staging article HTML must explicitly declare noindex.");
console.log("PASS known article is available with both header and HTML noindex.");

const unknownArticlePath = "/articles/definitely-not-an-article-404-smoke";
let unknownArticle;
for (let attempt = 1; attempt <= 45; attempt++) {
  unknownArticle = await request(unknownArticlePath);
  if (unknownArticle.status === 404) break;
  await unknownArticle.arrayBuffer();
  if (attempt < 45) await new Promise((resolve) => setTimeout(resolve, 2000));
}
assert.equal(unknownArticle.status, 404,
  "Unknown article must return HTTP 404 once the staging deployment is active; got " + unknownArticle.status + ".");
const unknownArticleHead = await request(unknownArticlePath, "HEAD");
assert.equal(unknownArticleHead.status, 404,
  "HEAD for an unknown article must return HTTP 404; got " + unknownArticleHead.status + ".");
console.log("PASS unknown article GET and HEAD return real HTTP 404.");

async function assertAuthRedirect(path, expectedMode, method) {
  const res = await request(path, method);
  assert.equal(res.status, 302, method + " " + path + " must return the auth redirect.");
  const location = res.headers.get("location");
  assert.ok(location, method + " " + path + " must include Location.");
  const target = new URL(location);
  assert.equal(target.origin, origin, "Auth redirect must remain on the staging origin.");
  assert.equal(target.pathname, "/", "Auth redirect must use the homepage form.");
  assert.equal(target.searchParams.get("mode"), expectedMode, "Auth mode must match the route.");
  assert.equal(target.hash, "#cong-dong", "Auth redirect must target the community form.");
  return target;
}

const loginPath = "/login?from=menu&utm_source=staging-smoke";
const loginTarget = await assertAuthRedirect(loginPath, "login", "GET");
assert.equal(loginTarget.searchParams.get("from"), "menu", "Login redirect must preserve existing query.");
assert.equal(loginTarget.searchParams.get("utm_source"), "staging-smoke", "Login redirect must preserve tracking query.");
await assertAuthRedirect("/register?campaign=staging-smoke", "register", "GET");
await assertAuthRedirect("/login?from=head-check", "login", "HEAD");
await assertAuthRedirect("/register?from=head-check", "register", "HEAD");
console.log("PASS GET/HEAD login and registration redirects preserve form mode and query parameters.");

console.log("No registration, password-reset request, email, database write, secret read, or production Worker was used.");
