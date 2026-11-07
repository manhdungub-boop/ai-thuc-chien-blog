import assert from "node:assert/strict";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "site-snapshot");
const outputRoot = path.join(root, "preview-output");
const robotsMeta = '<meta name="robots" content="noindex,nofollow,noarchive">';
const productionSiteOrigin = "https://ai-thuc-chien-blog.manhdungub.workers.dev";
const configuredPreviewUrl = process.env.CF_PAGES_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.PREVIEW_DEPLOYMENT_URL);
assert.ok(configuredPreviewUrl, "CF_PAGES_URL, VERCEL_URL or PREVIEW_DEPLOYMENT_URL must be set by the preview host");
const previewUrl = new URL(configuredPreviewUrl);
assert.equal(previewUrl.protocol, "https:", "preview URL must use HTTPS");
const isCloudflarePagesPreview = previewUrl.hostname.endsWith(".pages.dev");
const isVercelPreview = previewUrl.hostname.endsWith(".vercel.app");
assert.ok(isCloudflarePagesPreview || isVercelPreview, "preview URL must use a Cloudflare Pages or Vercel preview hostname");
const previewOrigin = previewUrl.origin;
const headersFile = "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n";
const robotsFile = "User-agent: *\nAllow: /\n";

assert.ok((await stat(sourceRoot)).isDirectory(), "site-snapshot must exist");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(sourceRoot, outputRoot, { recursive: true });
// The recovery README is repository-only incident context and must never be public.
await rm(path.join(outputRoot, "RECOVERY-README.txt"), { force: true });
await rm(path.join(outputRoot, "_headers"), { force: true });
// Candidate review records and internal notes must not be exposed by a public preview.
await rm(path.join(outputRoot, "data", "review"), { recursive: true, force: true });
await assert.rejects(stat(path.join(outputRoot, "RECOVERY-README.txt")), "preview output must exclude internal recovery notes");
await assert.rejects(stat(path.join(outputRoot, "data", "review")), "preview output must exclude internal catalog review candidates");

async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(fullPath));
    else if (item.isFile()) files.push(fullPath);
  }
  return files;
}

const htmlFiles = (await walk(outputRoot)).filter((file) => file.endsWith(".html"));
const articleFiles = htmlFiles.filter((file) => file.includes(path.sep + "articles" + path.sep));
assert.equal(articleFiles.length, 69, "preview output must include all 69 reviewed article pages");
assert.ok(htmlFiles.length >= 69, "preview output must include the 69 articles plus non-article HTML pages");
let robotsMetaCount = 0;

for (const file of htmlFiles) {
  let html = await readFile(file, "utf8");
  const metaPattern = /<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*>/i;
  if (metaPattern.test(html)) {
    html = html.replace(metaPattern, robotsMeta);
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, "  " + robotsMeta + "\n</head>");
  } else {
    throw new Error("HTML page has no head element: " + path.relative(outputRoot, file));
  }
  assert.ok(html.includes(robotsMeta), "preview page must be noindex: " + path.relative(outputRoot, file));
  await writeFile(file, html);
  robotsMetaCount += 1;
}
assert.equal(robotsMetaCount, htmlFiles.length, "every HTML page must be stamped noindex in preview output");

// Replace working-looking account UI with a clear preview-only notice. Keep underlying DOM
// IDs so the shared site script remains compatible, but hide all account and chat forms.
// A fetch guard prevents community API calls (including hash-token verification) from leaving the preview page.
const homepagePath = path.join(outputRoot, "index.html");
let previewHome = await readFile(homepagePath, "utf8");
const communityKicker = '<div class="community-card-kicker">TÀI KHOẢN THÀNH VIÊN</div>';
assert.ok(previewHome.includes(communityKicker), "homepage must include the known community account panel");
previewHome = previewHome.replace(
  communityKicker,
  communityKicker + '\n      <p id="preview-account-disabled-notice" class="community-muted">Tài khoản, xác minh email, đặt lại mật khẩu và gửi tin nhắn không hoạt động trong bản xem trước. Không nhập mật khẩu, mã xác minh hoặc dữ liệu cá nhân tại đây.</p>'
);
const previewInteractionStyle = `<style id="preview-interaction-guard">
#community-auth-panel form,
#community-auth-panel .community-auth-switch,
#community-auth-panel #community-resend-verification,
#community-auth-panel #community-forgot-password,
#community-chat-form,
#reader-ai-chat { display: none !important; }
</style>`;
const previewApiGuard = `<script id="preview-api-guard">
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    let target;
    try {
      target = new URL(typeof input === "string" ? input : input.url, window.location.href);
    } catch {
      return Promise.reject(new TypeError("Invalid URL"));
    }
    const communityApi = target.origin === window.location.origin && /^\/api\/community(?:\/|$)/.test(target.pathname);
    const productionReaderApi = target.origin === "https://ai-thuc-chien-blog.manhdungub.workers.dev" && target.pathname === "/api/chat";
    if (communityApi || productionReaderApi) {
      return Promise.resolve(new Response(JSON.stringify({ error: "Tính năng tài khoản đã tắt trên bản xem trước." }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
      }));
    }
    return nativeFetch(input, init);
  };
})();
</script>`;
assert.ok(previewHome.includes("</head>"), "preview homepage must have a head element");
for (const file of htmlFiles) {
  const pageHtml = file === homepagePath ? previewHome : await readFile(file, "utf8");
  assert.ok(pageHtml.includes("</head>"), "preview page must have a head element: " + path.relative(outputRoot, file));
  let guardedHtml = pageHtml;
  const rewriteMetadataTag = (tag) => tag.replaceAll(productionSiteOrigin, previewOrigin);
  guardedHtml = guardedHtml.replace(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi, rewriteMetadataTag);
  guardedHtml = guardedHtml.replace(/<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>/gi, rewriteMetadataTag);
  guardedHtml = guardedHtml.replace(/<meta\b(?=[^>]*\bname=["']twitter:url["'])[^>]*>/gi, rewriteMetadataTag);
  guardedHtml = guardedHtml.replace(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, rewriteMetadataTag);
  const canonicalTags = guardedHtml.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi) || [];
  for (const tag of canonicalTags) {
    assert.ok(tag.includes(previewOrigin), "canonical must point to this preview deployment: " + path.relative(outputRoot, file));
    assert.ok(!tag.includes(productionSiteOrigin), "canonical must not point to production: " + path.relative(outputRoot, file));
  }
  const ogUrlTags = guardedHtml.match(/<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>/gi) || [];
  for (const tag of ogUrlTags) {
    assert.ok(tag.includes(previewOrigin), "og:url must point to this preview deployment: " + path.relative(outputRoot, file));
    assert.ok(!tag.includes(productionSiteOrigin), "og:url must not point to production: " + path.relative(outputRoot, file));
  }
  const jsonLdBlocks = guardedHtml.match(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of jsonLdBlocks) {
    assert.ok(!block.includes(productionSiteOrigin), "JSON-LD must not reference production canonical URLs: " + path.relative(outputRoot, file));
  }
  guardedHtml = guardedHtml.replace("</head>", previewInteractionStyle + "\n" + previewApiGuard + "\n</head>");
  assert.ok(guardedHtml.includes('id="preview-api-guard"'), "preview API guard must be present: " + path.relative(outputRoot, file));
  assert.ok(guardedHtml.includes("#reader-ai-chat"), "preview reader chat must be disabled: " + path.relative(outputRoot, file));
  await writeFile(file, guardedHtml);
}
const guardedHomepage = await readFile(homepagePath, "utf8");
assert.ok(guardedHomepage.includes('id="preview-account-disabled-notice"'));
assert.ok(guardedHomepage.includes("display: none !important"));
assert.ok(guardedHomepage.includes("Không nhập mật khẩu, mã xác minh"));

await writeFile(path.join(outputRoot, "_headers"), headersFile);
await writeFile(path.join(outputRoot, "robots.txt"), robotsFile);
const notFoundHtml = [
  "<!doctype html>",
  '<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  robotsMeta,
  "<title>Không tìm thấy trang | AI Thực Chiến</title></head>",
  '<body><main><h1>Không tìm thấy trang</h1><p>Đường dẫn này không có trong bản xem trước.</p><p><a href="/">Quay lại trang chủ</a></p></main></body></html>',
].join("\n");
await writeFile(path.join(outputRoot, "404.html"), notFoundHtml);
// The preview must not expose a sitemap containing production canonical URLs.
await rm(path.join(outputRoot, "sitemap.xml"), { force: true });

const builtHeaders = await readFile(path.join(outputRoot, "_headers"), "utf8");
const builtRobots = await readFile(path.join(outputRoot, "robots.txt"), "utf8");
assert.match(builtHeaders, /X-Robots-Tag:\s*noindex,\s*nofollow,\s*noarchive/i);
assert.ok((await readFile(path.join(outputRoot, "404.html"), "utf8")).includes(robotsMeta), "preview 404 page must also be noindex");
assert.doesNotMatch(builtRobots, /Sitemap:/i);
await assert.rejects(stat(path.join(outputRoot, "sitemap.xml")), "preview sitemap must be absent");

console.log("PASS preview-only output: " + articleFiles.length + " article pages and " + htmlFiles.length + " HTML pages use noindex metadata");
console.log("PASS canonical, Open Graph and JSON-LD URLs are rewritten to this preview deployment");
console.log("PASS preview-only X-Robots-Tag header is generated outside site-snapshot");
console.log("PASS preview robots.txt allows crawlers to read noindex and omits production sitemap");
console.log("PASS production sitemap is not copied into preview output");
console.log("PASS preview has an explicit noindex 404 page for missing assets");
console.log("PASS preview output excludes RECOVERY-README.txt and stale _headers files");
