import assert from "node:assert/strict";
import worker from "../recovery-snapshots/worker-email-verification-candidate.mjs";

const canonical = "https://ai-thuc-chien-blog.manhdungub.workers.dev/";
const productionLogoUrl = canonical + "logo.svg";
const stagingHost = "ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const stagingLogoUrl = "https://" + stagingHost + "/logo.svg";
const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64"></svg>';
const homeHtml = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "name": "AI Thực Chiến", "url": canonical },
    { "@type": "WebSite", "name": "AI Thực Chiến", "url": canonical }
  ]
})}</script></head><body>Homepage</body></html>`;
const articleHtml = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "Sample article",
  "publisher": { "@type": "Organization", "name": "AI Thực Chiến", "url": canonical }
})}</script></head><body>Article</body></html>`;

const originalFetch = globalThis.fetch;
let fetched = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  fetched.push({ host: url.hostname, pathname: url.pathname, method: init?.method || "GET" });
  if (url.hostname === stagingHost && url.pathname === "/logo.svg") {
    return new Response(logoSvg, { status: 200, headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
  }
  assert.equal(url.hostname, "ai-thuc-chien-blog.pages.dev", "HTML fallback must use the independent Pages host");
  const html = url.pathname === "/" ? homeHtml : articleHtml;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
};

try {
  const homeResponse = await worker.fetch(new Request("https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev/"), {});
  assert.equal(homeResponse.status, 200);
  const homeText = await homeResponse.text();
  const homeScript = homeText.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(homeScript, "homepage JSON-LD should remain present");
  const homeJson = JSON.parse(homeScript[1]);
  assert.equal(homeJson["@graph"].find((node) => node["@type"] === "Organization").logo, stagingLogoUrl);

  const articleResponse = await worker.fetch(new Request("https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev/articles/sample-article"), {});
  assert.equal(articleResponse.status, 200);
  const articleText = await articleResponse.text();
  const articleScript = articleText.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(articleScript, "article JSON-LD should remain present");
  const articleJson = JSON.parse(articleScript[1]);
  assert.equal(articleJson.publisher.logo, stagingLogoUrl);

  const logoResponse = await worker.fetch(new Request("https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev/logo.svg"), {});
  assert.equal(logoResponse.status, 200);
  assert.match(logoResponse.headers.get("Content-Type") || "", /image\/svg\+xml/i);
  assert.match(await logoResponse.text(), /width="512" height="512"/);

  const productionResponse = await worker.fetch(new Request("https://ai-thuc-chien-blog.manhdungub.workers.dev/"), {});
  const productionText = await productionResponse.text();
  const productionScript = productionText.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(productionScript, "production-host homepage JSON-LD should remain present");
  const productionJson = JSON.parse(productionScript[1]);
  assert.equal(productionJson["@graph"].find((node) => node["@type"] === "Organization").logo, productionLogoUrl,
    "production hostname must retain the canonical production logo URL");

  const diagnosticResponse = await worker.fetch(new Request("https://" + stagingHost + "/__staging/seo-schema"), {});
  assert.equal(diagnosticResponse.status, 200);
  const diagnostic = await diagnosticResponse.json();
  assert.equal(diagnostic.ok, true, "overall staging SEO diagnostic succeeds only when JSON-LD and logo response checks pass");
  assert.equal(diagnostic.logo_url, stagingLogoUrl, "staging diagnostic must report the staging-host logo URL");
  assert.equal(diagnostic.logo_asset_probe_ok, "true", "staging diagnostic must visibly report a successful logo probe");
  assert.equal(diagnostic.logo_asset_response_status, "200");
  assert.ok((diagnostic.logo_asset_response_content_type || "").toLowerCase().includes("image/svg+xml"));
  assert.equal(diagnostic.logo_asset_response_body_valid, "true");
  assert.equal(diagnostic.homepage_organization_logo_present, true);
  assert.equal(diagnostic.article_publisher_logo_present, true);

  assert.ok(fetched.some((x) => x.pathname === "/"), "homepage must be fetched");
  assert.ok(fetched.some((x) => x.pathname === "/articles/sample-article.html"), "extensionless article route must resolve to .html");
  assert.ok(!fetched.some((x) => x.hostname === stagingHost && x.pathname === "/logo.svg"), "SEO diagnostic validates the shared logo response factory without recursively fetching its own Worker URL");
  console.log("PASS staging homepage Organization JSON-LD points to the staging logo endpoint");
  console.log("PASS staging article publisher JSON-LD points to the staging logo endpoint");
  console.log("PASS production-host HTML keeps the canonical production logo URL");
  console.log("PASS staging logo diagnostic confirms status, content type and 512x512 SVG body");
} finally {
  globalThis.fetch = originalFetch;
}
