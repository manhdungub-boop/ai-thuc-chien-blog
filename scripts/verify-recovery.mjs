import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const main = await readFile("recovery-snapshots/worker.mjs", "utf8");
const preview = await readFile("recovery-snapshots/auth-app-preview.mjs", "utf8");
const smallPreview = await readFile("recovery-snapshots/auth-preview.mjs", "utf8");

const checks = [
  ["preview stores verification tokens", preview.includes("community_email_verification_tokens")],
  ["preview tracks verification state", preview.includes("email_verified_at")],
  ["login blocks unverified users", preview.includes("Bạn cần xác nhận email trước khi đăng nhập.")],
  ["verification token expires after 30 minutes", preview.includes("1800000")],
  ["email relay secret is required", preview.includes("COMMUNITY_EMAIL_RELAY_SECRET")],
  ["short relay secrets are rejected", preview.includes("secret.length<32")],
  ["relay failure is handled", preview.includes("if(!sent)")],
  ["verification token is consumed", preview.includes("DELETE FROM community_email_verification_tokens WHERE token_hash=?")],
  ["preview has login rate limiting", preview.includes("staging-login-ip:")],
  ["small preview references verification tokens", smallPreview.includes("community_email_verification_tokens")],
  ["production source is not falsely treated as integrated", !main.includes("community_email_verification_tokens")],
];

for (const [name, passed] of checks) {
  console.log((passed ? "PASS " : "FAIL ") + name);
}
assert.ok(checks.every(([, passed]) => passed), "One or more recovery source assertions failed.");

console.log("All recovery static assertions passed.");
console.log("These checks do not verify email delivery, browser behavior, D1 runtime behavior, or production integration.");
console.log("No deployment or database migration is performed by this script.");
