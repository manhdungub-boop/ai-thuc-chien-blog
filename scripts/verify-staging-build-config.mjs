import { readFileSync } from "node:fs";

const config = readFileSync("wrangler.staging.toml", "utf8");
const entry = readFileSync("staging-entrypoint.mjs", "utf8");

const authWorker = readFileSync("recovery-snapshots/worker-email-verification-candidate.mjs", "utf8");
const checks = [
  ["legacy review-host email links are canonicalized to the isolated Staging Worker", /request\.hostname === "review\.manhdungub\.workers\.dev"[\s\S]*?return COMMUNITY_OAUTH_STAGING_ORIGIN/.test(authWorker) && /sendCommunityVerificationEmail\(env, email, token, communityVerificationOrigin\(url\)\)/.test(authWorker)],
  ["staging Worker name", /name\s*=\s*"ai-thuc-chien-blog-auth-app-preview"/.test(config)],
  ["staging entrypoint", /main\s*=\s*"staging-entrypoint\.mjs"/.test(config)],
  ["staging D1 name and ID match the intended isolated database", /database_name\s*=\s*"ai-thuc-chien-blog-community-preview"/.test(config) && /database_id\s*=\s*"c8b301f0-afcf-4f36-9b8e-8194c01bbbc8"/.test(config)],
  ["production D1 excluded", !config.includes("fc2517cb-9543-4d7b-98f4-bcd5f3c013e7") && !config.includes("51d814c8-a3fc-4481-a5f1-60bc67617f3c")],
  ["AI binding", /\[ai\][\s\S]*?binding\s*=\s*"AI"/.test(config)],
  ["static assets binding", /\[assets\][\s\S]*?binding\s*=\s*"ASSETS"/.test(config)],
  ["staging Worker runs before static assets so preview noindex headers are applied", config.includes("run_worker_first = true")],
  ["dashboard variables preserved", /keep_vars\s*=\s*true/.test(config)],
  ["staging responses marked noindex in headers and static HTML metadata", /X-Robots-Tag/.test(entry) && /noindex, nofollow, noarchive/.test(entry) && /name="robots" content="noindex, nofollow, noarchive"/.test(entry)],
  ["static content uses the configured ASSETS binding, not public Pages", /env\.ASSETS\.fetch\(assetRequest\)/.test(entry) && !/assetUrl\.hostname\s*=\s*"ai-thuc-chien-blog\.pages\.dev"/.test(entry)],
  ["community API delegates to the isolated auth Worker", /isCommunityApiPath\(pathname\)/.test(entry) && /worker\.fetch\(request, env, ctx\)/.test(entry)],
  ["staging sitemap and feed XML are hidden", /PREVIEW_ONLY_METADATA_PATHS/.test(entry) && /sitemap\.xml/.test(entry)],
  ["organization logo is 512x512", /width="512"\s+height="512"/.test(readFileSync("site-snapshot/logo.svg", "utf8"))],
  ["staging wrapper rewrites production JSON-LD logo URLs to the current request host", entry.includes("PRODUCTION_LOGO_URL") && entry.includes('new URL("/logo.svg", request.url).toString()') && entry.includes("html.replaceAll(PRODUCTION_LOGO_URL, stagingLogoUrl)")],
  ["local staging routing tests cover JSON-LD logo URLs on homepage and article", readFileSync("scripts/test-staging-content-routing.mjs", "utf8").includes("homepage Organization JSON-LD uses the current staging logo URL") && readFileSync("scripts/test-staging-content-routing.mjs", "utf8").includes("weekly article author/publisher JSON-LD uses the staging logo URL")],
  ["staging snapshot contains exactly 69 article routes", (() => { const xml = readFileSync("site-snapshot/sitemap.xml", "utf8"); return new Set([...xml.matchAll(/<loc>[^<]*\/articles\/([^<]+)<\/loc>/g)].map(match => match[1])).size === 69; })()],

  ["staging robots.txt allows crawlers to observe the noindex directive", entry.includes("robots.txt") && entry.includes("Allow: /")],
  ["no literal relay secret in config", !/COMMUNITY_EMAIL_RELAY_SECRET\s*=/.test(config)],
];

for (const [label, ok] of checks) {
  process.stdout.write((ok ? "PASS " : "FAIL ") + label + "\n");
}
if (checks.some(([, ok]) => !ok)) process.exit(1);
