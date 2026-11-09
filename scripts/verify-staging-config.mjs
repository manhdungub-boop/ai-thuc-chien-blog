import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [healthWorker, appWorker, candidate, stagingEntrypoint, frontend, ci, relay, relayManifest, runbook, relayAudit, productionRelayAudit, liveAssetTest] = await Promise.all([
  read("../recovery-snapshots/auth-preview.mjs"),
  read("../recovery-snapshots/auth-app-preview.mjs"),
  read("../recovery-snapshots/worker-email-verification-candidate.mjs"),
  read("../staging-entrypoint.mjs"),
  read("../site-snapshot/script.js"),
  read("../.gitlab-ci.yml"),
  read("../email-relay/Code.gs"),
  read("../email-relay/appsscript.json"),
  read("../recovery-snapshots/EMAIL_RELAY_SETUP.md"),
  read("../recovery-snapshots/STAGING_APPS_SCRIPT_SOURCE_AUDIT_2026-10-26.md"),
  read("../recovery-snapshots/PRODUCTION_APPS_SCRIPT_RELAY_AUDIT_2026-10-26.md"),
  read("./test-live-staging-assets.mjs"),
]);

const previewHost = "ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const validRelayManifest = (() => {
  try {
    const manifest = JSON.parse(relayManifest);
    return manifest.webapp?.executeAs === "USER_DEPLOYING" &&
      manifest.webapp?.access === "ANYONE_ANONYMOUS" &&
      manifest.runtimeVersion === "V8" &&
      Array.isArray(manifest.oauthScopes) &&
      manifest.oauthScopes.includes("https://www.googleapis.com/auth/script.send_mail");
  } catch {
    return false;
  }
})();
const checks = [
  ["health worker remains read-only", healthWorker.includes("writes_enabled:false")],
  ["health worker never claims email sending is enabled", healthWorker.includes("email_sending_enabled:false")],
  ["read-only schema check reports email sending disabled", healthWorker.includes("writes_enabled:false,email_sending_enabled:false")],
  ["app preview only reports email configured when URL and secret are present", appWorker.includes('Boolean(env.COMMUNITY_EMAIL_RELAY_URL&&String(env.COMMUNITY_EMAIL_RELAY_SECRET||"").length>=32)')],
  ["registration checks relay configuration before inserting a member", (() => { const start = candidate.indexOf('if (route === "register"'); const insert = candidate.indexOf("INSERT INTO community_members", start); const check = candidate.indexOf("EMAIL_RELAY_NOT_CONFIGURED", start); return start >= 0 && insert > start && check > start && check < insert; })()],
  ["candidate serves the canonical Organization logo through a shared response factory without relying on Pages", candidate.includes('pathname === "/logo.svg"') && candidate.includes("function createOrganizationLogoResponse") && candidate.includes('"Content-Type": "image/svg+xml; charset=utf-8"') && candidate.includes('width="512" height="512"') && candidate.includes("ORGANIZATION_LOGO_SVG")],
  ["candidate rewrites canonical Organization/BlogPosting logo JSON-LD on HTML responses", candidate.includes("function patchOrganizationLogoInHtml(html, logoUrl = ORGANIZATION_LOGO_URL)") && candidate.includes("function withOrganizationLogoSchema(response, logoUrl = ORGANIZATION_LOGO_URL)") && candidate.includes("node.logo = logoUrl") && candidate.includes("await withOrganizationLogoSchema(assetResponse, organizationLogoUrl)")],
  ["candidate uses a staging-host logo URL in staging responses and the production canonical URL otherwise", candidate.includes("function organizationLogoUrlForRequest(requestUrl)") && candidate.includes('"https://" + STAGING_WORKER_HOST + "/logo.svg"') && candidate.includes("const organizationLogoUrl = organizationLogoUrlForRequest(requestUrl)") && candidate.includes("withOrganizationLogoSchema(assetResponse, organizationLogoUrl)")],
  ["SEO diagnostic returns explicit logo probe strings and validates the staging asset URL", candidate.includes('logo_asset_probe_ok: String(logoAssetProbe.ok)') && candidate.includes('logo_asset_response_status: String(logoAssetProbe.status ?? "null")') && candidate.includes("probePageStructuredData(\"/\", organizationLogoUrl)") && candidate.includes("logo_url: organizationLogoUrl") && candidate.includes("article_publisher_logo_present && logoAssetProbe.ok")],
  ["candidate exposes safe SEO and logo-asset diagnostics on the exact staging host", candidate.includes('pathname === "/__staging/seo-schema"') && candidate.includes("homepage_organization_logo_present") && candidate.includes("article_publisher_logo_present") && candidate.includes("logo_asset_response_status") && candidate.includes("logo_asset_response_content_type") && candidate.includes("logo_asset_response_body_valid") && candidate.includes("createOrganizationLogoResponse(\"GET\")") && candidate.includes('requestUrl.hostname === STAGING_WORKER_HOST')],
  ["candidate redirects direct login/register URLs to the matching mode", candidate.includes('pathname === "/login"') && candidate.includes('pathname === "/register"') && candidate.includes('authUrl.searchParams.set("mode", pathname.slice(1))')],
  ["candidate and frontend allow the dedicated isolated preview hostname", candidate.includes("https://" + previewHost) && frontend.includes(previewHost)],
  ["candidate permits preview-origin chat requests explicitly", candidate.includes('const CHAT_ALLOWED_ORIGINS = new Set([') && candidate.includes('"https://' + previewHost + '"')],
  ["static asset fallback works without a Workers Assets binding", candidate.includes("const assetUrl = new URL(assetRequest.url)") && candidate.includes('assetUrl.hostname = "ai-thuc-chien-blog.pages.dev"')],
  ["preview serves patched frontend JavaScript without changing Pages", candidate.includes("const PREVIEW_FRONTEND_SCRIPT = ") && candidate.includes('pathname === "/script.js"') && candidate.includes("ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev")],
  ["read-only diagnostics are bound to the exact preview hostname", candidate.includes('requestUrl.hostname === "ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev"') && candidate.includes('pathname === "/__staging/status"')],
  ["preview status checks D1 schema and fails closed without email configuration", candidate.includes("schemaReady = requiredTables.every((name) => tableNames.has(name))") && candidate.includes("registration_ready: databaseReady && schemaReady && emailSendingEnabled") && candidate.includes("emailSendingEnabled = false")],
  ["preview diagnostics never serialize the shared secret or relay URL", !candidate.includes("JSON.stringify({ COMMUNITY_EMAIL_RELAY_SECRET") && !candidate.includes("JSON.stringify({ COMMUNITY_EMAIL_RELAY_URL")],
  ["preview responses carry a noindex header only for the staging hostname", candidate.includes('headers.set("X-Robots-Tag", "noindex, nofollow, noarchive")') && candidate.includes('requestUrl.hostname === "ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev"')],
  ["candidate retains its dedicated robots.txt route and staging wrapper exposes a crawler-visible noindex policy", candidate.includes('pathname === "/robots.txt"') && candidate.includes("Disallow: /") && stagingEntrypoint.includes('url.pathname === "/robots.txt"') && stagingEntrypoint.includes("Allow: /") && stagingEntrypoint.includes('name="robots" content="noindex, nofollow, noarchive"')],
  ["CI release is a single opt-in staging-only manual job; no production deployment or D1 migration is defined", (() => {
    const lines = ci.split(/\r?\n/);
    const start = lines.findIndex((line) => line === "staging-worker-assets-release:");
    if (start < 0) return false;
    let end = start + 1;
    while (end < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[end])) end++;
    const job = lines.slice(start, end).join("\n");
    const stageBlock = (ci.match(/^stages:\s*\n((?:\s+-[^\n]*\n)+)/m) || [])[1] || "";
    const stageNames = [...stageBlock.matchAll(/^\s+-\s*([\w-]+)/gm)].map((match) => match[1]);
    const jobNames = lines.filter((line) => /^[A-Za-z0-9_.-]+:\s*$/.test(line)).map((line) => line.replace(/:\s*$/, ""));
    const releaseJobs = jobNames.filter((name) => /deploy|release|production/i.test(name));
    const isolatedStart = lines.findIndex((line) => line === "isolated-worker-assets-release:");
    if (isolatedStart < 0) return false;
    let isolatedEnd = isolatedStart + 1;
    while (isolatedEnd < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[isolatedEnd])) isolatedEnd++;
    const isolatedJob = lines.slice(isolatedStart, isolatedEnd).join("\n");
    return job.includes("when: manual") &&
      job.includes("allow_failure: true") &&
      job.includes('$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "feature/social-login-google-facebook-20261101"') &&
      job.includes("name: staging") &&
      job.includes("CLOUDFLARE_API_TOKEN") &&
      job.includes("wrangler@latest deploy --config wrangler.staging.toml --secrets-file /tmp/wrangler-preserve-secrets.json") &&
      job.includes("node scripts/test-live-staging-assets.mjs") &&
      !job.includes("keep_assets: true") &&
      isolatedJob.includes("when: manual") &&
      isolatedJob.includes("allow_failure: true") &&
      isolatedJob.includes('$CI_COMMIT_BRANCH == "fix/isolated-worker-assets-release-20261104"') &&
      isolatedJob.includes("name: isolated-test") &&
      isolatedJob.includes("resource_group: ai-thuc-chien-blog-isolated-test") &&
      isolatedJob.includes("wrangler@latest deploy --config wrangler.isolated.toml --secrets-file /tmp/wrangler-preserve-secrets.json") &&
      isolatedJob.includes("node scripts/test-live-isolated-assets.mjs") &&
      stageNames.includes("validate") &&
      stageNames.includes("staging-build-check") &&
      !stageNames.some((name) => /deploy|release|production/i.test(name)) &&
      releaseJobs.every((name) => ["staging-worker-assets-release", "isolated-worker-assets-release"].includes(name)) &&
      !/production-deploy|d1 execute/i.test(ci);
  })()],
  ["frontend forwards API error codes so verification resend can be offered", frontend.includes("error.code = payload.code || null")],
  ["manual staging release is serialized and limited to reviewed staging target", (() => {
    const lines = ci.split(/\r?\n/);
    const start = lines.findIndex((line) => line === "staging-worker-assets-release:");
    if (start < 0) return false;
    let end = start + 1;
    while (end < lines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(lines[end])) end++;
    const job = lines.slice(start, end).join("\n");
    return job.includes("resource_group: ai-thuc-chien-blog-staging") &&
      job.includes("wrangler.staging.toml") &&
      job.includes(previewHost) &&
      !job.includes("wrangler.toml");
  })()],
  ["relay source has exactly one doPost handler", (relay.match(/\bfunction\s+doPost\s*\(/g) || []).length === 1],
  ["relay source fails closed when the host allowlist is missing", relay.includes("getProperty('COMMUNITY_EMAIL_ALLOWED_HOSTS') || ''") && !relay.includes("getProperty('COMMUNITY_EMAIL_ALLOWED_HOSTS') || 'ai-thuc-chien-blog.manhdungub.workers.dev'")],
  ["Apps Script manifest explicitly declares the required web app access and mail scope", validRelayManifest],
  ["runbook points to the exact Apps Script staging project ID", runbook.includes("1PGtZzT-CMibtkPUaV604g8rZMaWn_WJKlfTVIOnPj0x88u_D5K7f_MNJ")],
  ["runbook identifies the current 2026-10-26 source audit and supersedes the older warning", runbook.includes("Current staging status — verified 2026-10-26") && runbook.includes("supersedes the 2026-10-25 source-audit warning")],
  ["current staging source audit confirms the reviewed SHA-256 and exactly one doPost", relayAudit.includes("263a9ee07718bc8010003f88db51d6b10e1714a6e2b15afe7d9e25da5c68db7d") && relayAudit.includes("same SHA-256") && relayAudit.includes("Current export contains one")],
  ["production relay audit records duplicate doPost declarations and production-host fallback", productionRelayAudit.includes("two global") && productionRelayAudit.includes("default the allowlist to the public production hostname") && productionRelayAudit.includes("Production relay readiness: NO-GO")],
  ["production relay audit keeps active deployment mapping and Script Properties marked unknown", productionRelayAudit.includes("active Web App deployment ID/version") && productionRelayAudit.includes("Script Properties were read or changed")],
  ["runbook makes the unknown active Apps Script deployment ID/version explicit", runbook.includes("active Apps Script Web App deployment ID/version has not yet been independently confirmed")],
  ["runbook protects existing member/session rows from blanket staging cleanup", runbook.includes("Preserve all existing member and session rows") && runbook.includes("Never run a blanket DELETE or reset the staging database")],
  ["historical source replacement procedure is gated to confirmed drift only", runbook.includes("Recovery-only procedure") && runbook.includes("Do not repeat these steps while the current source and live test remain verified")],
  ["runbook explicitly removes stale appsscript.js handler while preserving appsscript.json manifest", runbook.includes("appsscript.js") && runbook.includes("Do not delete the") && runbook.includes("appsscript.json") && runbook.includes("exactly one") && runbook.includes("function doPost")],
  ["registration reminder names the exact email address and explains confirmation is required", frontend.includes("Tài khoản đã được tạo nhưng chưa kích hoạt.") && frontend.includes("payload.email") && frontend.includes("trong vòng 30 phút.")],
  ["registration reminder tells members to check Spam and Promotions", frontend.includes("Thư rác/Spam và Quảng cáo")],
  ["resend reminder names the requested email and advises checking Inbox, Spam, and Promotions", frontend.includes("Đã tiếp nhận yêu cầu cho địa chỉ") && frontend.includes("mục Thư rác/Spam và Quảng cáo")],
  ["live asset smoke test verifies frontend JS, CSS and configured Google readiness without logging secrets", liveAssetTest.includes('"/script.js"') && liveAssetTest.includes('"/styles.css"') && liveAssetTest.includes('oauth/providers') && liveAssetTest.includes('".community-social-auth"') && liveAssetTest.includes("providers.google !== true")],
  ["real-email E2E jobs are manual-only on the dedicated staging branch", (() => {
    const jobs = ["staging-email-registration-e2e", "staging-email-confirmation-e2e", "staging-password-reset-request-e2e", "staging-password-reset-finish-e2e"];
    const ciLines = ci.split(/\r?\n/);
    const blockFor = (name) => {
      const startLine = ciLines.findIndex((line) => line === name + ":");
      if (startLine < 0) return "";
      let endLine = startLine + 1;
      while (endLine < ciLines.length && !/^[A-Za-z0-9_.-]+:\s*$/.test(ciLines[endLine])) endLine++;
      return ciLines.slice(startLine, endLine).join("\n");
    };
    return !ci.includes("$CI_PIPELINE_SOURCE =~ /^(api|web)$/") &&
      !ci.includes("$STAGING_EMAIL_E2E_ACTION =~ /^(register|confirm|request-reset|finish-reset)$/") &&
      jobs.every((name) => {
        const block = blockFor(name);
        return block.includes("when: manual") &&
          block.includes("allow_failure: true") &&
          block.includes('$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "staging/auth-worker-build"') &&
          block.includes('$CI_COMMIT_BRANCH == "staging/auth-worker-build"') &&
          !block.includes("$CI_PIPELINE_SOURCE") &&
          !block.includes("STAGING_EMAIL_E2E_ACTION") &&
          block.includes("node scripts/test-live-staging-email-e2e.mjs");
      });
  })()],
];

for (const [name, pass] of checks) console.log((pass ? "PASS " : "FAIL ") + name);
assert.ok(checks.every(([, pass]) => pass), "Staging configuration contract checks failed.");
console.log("All staging configuration contract checks passed: " + checks.length + " checks.");
