import { readFileSync } from "node:fs";

const config = readFileSync("wrangler.isolated.toml", "utf8");
const entry = readFileSync("staging-entrypoint.mjs", "utf8");
const snapshotScript = readFileSync("site-snapshot/script.js", "utf8");
const checks = [
  ["isolated Worker exact name", /name\s*=\s*"ai-thuc-chien-blog-auth-isolated-20261104"/.test(config)],
  ["isolated D1 exact name and UUID", /database_name\s*=\s*"ai-thuc-chien-blog-prod-schema-clone-20261104"/.test(config) && /database_id\s*=\s*"3c3e6410-17ab-49dd-9151-012acc085286"/.test(config)],
  ["production and staging D1 excluded", !config.includes("fc2517cb-9543-4d7b-98f4-bcd5f3c013e7") && !config.includes("c8b301f0-afcf-4f36-9b8e-8194c01bbbc8") && !config.includes("51d814c8-a3fc-4481-a5f1-60bc67617f3c")],
  ["isolated Worker entrypoint", /main\s*=\s*"staging-entrypoint\.mjs"/.test(config)],
  ["complete static snapshot bound", /directory\s*=\s*"\.\/site-snapshot"/.test(config) && /binding\s*=\s*"ASSETS"/.test(config)],
  ["dashboard variables and secret bindings preserved", /keep_vars\s*=\s*true/.test(config)],
  ["no literal relay secret", !/COMMUNITY_EMAIL_RELAY_SECRET\s*=/.test(config)],
  ["static frontend explicitly permits isolated hostname", snapshotScript.includes("ai-thuc-chien-blog-auth-isolated-20261104.manhdungub.workers.dev")],
  ["auth worker delegation remains enabled", /isCommunityApiPath\(pathname\)/.test(entry) && /worker\.fetch\(request, env, ctx\)/.test(entry)],
  ["staging noindex wrapper retained for isolated testing", entry.includes("noindex, nofollow, noarchive")],
];
for (const [label, ok] of checks) process.stdout.write((ok ? "PASS " : "FAIL ") + label + "\n");
if (checks.some(([, ok]) => !ok)) process.exit(1);
