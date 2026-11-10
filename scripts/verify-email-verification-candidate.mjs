import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hasExactUrlReference } from "./url-assertions.mjs";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const candidate = await read("../recovery-snapshots/worker-email-verification-candidate.mjs");
const original = await read("../recovery-snapshots/worker.mjs");
const frontend = await read("../site-snapshot/script.js");
const css = await read("../site-snapshot/styles.css");
const html = await read("../site-snapshot/index.html");
const relay = await read("../email-relay/Code.gs");
const relayManifest = JSON.parse(await read("../email-relay/appsscript.json"));

const registerStart = candidate.indexOf('if (route === "register"');
const verifyStart = candidate.indexOf('if (route === "verify-email"', registerStart);
const registerBlock = candidate.slice(registerStart, verifyStart);
const loginStart = candidate.indexOf('if (route === "login"');
const logoutStart = candidate.indexOf('if (route === "logout"', loginStart);
const loginBlock = candidate.slice(loginStart, logoutStart);

const checks = [
  ["original production snapshot remains unchanged", !original.includes("community_email_verification_tokens")],
  ["candidate avoids the missing production email_verification_required column", !candidate.includes("email_verification_required") && candidate.includes("email_verified_at")],
  ["direct login and register URLs redirect to the matching community form mode", candidate.includes('pathname === "/login"') && candidate.includes('pathname === "/register"') && candidate.includes('authUrl.searchParams.set("mode", pathname.slice(1))') && candidate.includes('authUrl.hash = "cong-dong"')],
  ["frontend honors and cleans the requested login/register mode", frontend.includes("const requestedMode = verifyParams.get('mode')") && frontend.includes("setAuthMode(initialAuthMode)") && frontend.includes("verifyParams.delete('mode')")],
  ["candidate builds a fragment-only verification URL", candidate.includes('const link = new URL("/", origin)') && candidate.includes('link.hash = "cong-dong?verify=" + token') && !candidate.includes('link.searchParams.set("verify", token)')],
  ["candidate has bounded Apps Script relay helper", candidate.includes("async function sendCommunityVerificationEmail") && candidate.includes('relay.hostname !== "script.google.com"')],
  ["relay requires HTTPS", candidate.includes('relay.protocol !== "https:"')],
  ["relay call has timeout", candidate.includes("AbortSignal.timeout(8000)")],
  ["missing relay fails closed before member creation", registerBlock.indexOf("EMAIL_RELAY_NOT_CONFIGURED") >= 0 && registerBlock.indexOf("EMAIL_RELAY_NOT_CONFIGURED") < registerBlock.indexOf("INSERT INTO community_members")],
  ["new registration inserts NULL verification timestamp", registerBlock.includes("email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)")],
  ["registration does not create a session", !registerBlock.includes("createCommunitySession") && registerBlock.includes("pendingVerification: true")],
  ["mail failure removes pending member and token", registerBlock.includes("EMAIL_RELAY_FAILED") && registerBlock.includes("DELETE FROM community_email_verification_tokens WHERE member_id = ?") && registerBlock.includes("DELETE FROM community_members WHERE id = ?")],
  ["verification tokens are hashed before storage", registerBlock.includes("const tokenHash = await sha256Base64Url(token)")],
  ["verification token lifetime is 30 minutes", registerBlock.includes("30 * 60 * 1000")],
  ["verification route validates token format", candidate.includes('route === "verify-email"') && candidate.includes("^[A-Za-z0-9_-]{32,80}$")],
  ["verification route consumes the token", candidate.includes("DELETE FROM community_email_verification_tokens WHERE token_hash = ?")],
  ["verification-token landing URLs suppress Referer headers", candidate.includes('requestUrl.searchParams.has("verify")') && candidate.includes('headers.set("Referrer-Policy", "no-referrer")')],
  ["homepage proxy never forwards verification token to Pages", candidate.includes('pagesUrl.searchParams.delete("verify")') && candidate.indexOf('pagesUrl.searchParams.delete("verify")') < candidate.indexOf('await fetch(pagesUrl.toString()')],
  ["resend endpoint uses generic response and rate limits", candidate.includes('route === "resend-verification"') && candidate.includes("resend-email:") && candidate.includes("resend-ip:")],
  ["login queries verification state", loginBlock.includes("email_verified_at FROM community_members")],
  ["login blocks unverified members", loginBlock.includes("EMAIL_VERIFICATION_REQUIRED")],
  ["frontend requires an explicit click so link previews cannot consume verification tokens", frontend.includes("fragmentVerifyParams.get('verify')") && frontend.includes("confirmEmailButton.addEventListener('click'") && candidate.includes("confirmEmailButton.addEventListener('click'") && frontend.includes("Nhấn nút bên dưới để xác nhận email.") && candidate.includes("Nhấn nút bên dưới để xác nhận email.") && !frontend.includes("if (verificationToken) {\n    api('/verify-email'")],
  ["frontend exposes resend action", html.includes('id="community-resend-verification"') && frontend.includes("api('/resend-verification'")],
  ["preview origin is limited to explicit allowlist", hasExactUrlReference(candidate, "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev/") && frontend.includes("ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev")],
  ["relay code checks the shared secret and allowed hosts", relay.includes("COMMUNITY_EMAIL_RELAY_SECRET") && relay.includes("COMMUNITY_EMAIL_ALLOWED_HOSTS")],
  ["Apps Script uses V8 and only the MailApp send scope", relayManifest.runtimeVersion === "V8" && relayManifest.oauthScopes.length === 1 && relayManifest.oauthScopes[0] === "https://www.googleapis.com/auth/script.send_mail"],

  ["password reset tokens are atomically claimed", candidate.includes("community_password_reset_tokens") && candidate.includes("DELETE FROM community_password_reset_tokens WHERE token_hash = ? AND expires_at > ? RETURNING member_id")],
  ["password reset requests are generic and rate limited", candidate.includes("request-password-reset") && candidate.includes("password-reset-email:") && candidate.includes("password-reset-ip:")],
  ["staging readiness checks the password-reset table", candidate.includes('"community_password_reset_tokens"') && candidate.includes("requiredTables.every((name) => tableNames.has(name))")],
  ["reset endpoint updates the password and revokes sessions", candidate.includes("reset-password") && candidate.includes("UPDATE community_members SET password_salt = ?, password_hash = ? WHERE id = ?") && candidate.includes("DELETE FROM community_sessions WHERE member_id = ?")],
  ["reset email uses fragment-only link accepted by relay", candidate.includes("cong-dong?reset=") && relay.includes("(?:verify|reset)")],
  ["frontend exposes reset action and new-password form", html.includes("community-forgot-password") && html.includes("community-password-reset-form") && frontend.includes("request-password-reset") && frontend.includes("reset-password")],
  ["preview Worker embeds exactly the source-controlled frontend", (() => { const match = candidate.match(/^const PREVIEW_FRONTEND_SCRIPT = (".*");$/m); return Boolean(match && JSON.parse(match[1]) === frontend); })()],
  ["preview frontend creates reset controls if Pages HTML is stale", frontend.includes("document.createElement('form')") && frontend.includes("document.createElement('button')") && frontend.includes("community-password-reset-style")],
  ["frontend removes reset token from address bar", frontend.includes("fragmentVerifyParams.get('reset')") && frontend.includes("pendingPasswordResetToken = resetToken") && frontend.includes("window.history.replaceState")],
  ["staging homepage HTML is served from reviewed snapshot", candidate.includes("const PREVIEW_INDEX_HTML = " + JSON.stringify(html) + ";") && candidate.includes('pathname === "/" || pathname === "/index.html"') && candidate.includes("PREVIEW_INDEX_HTML")],
  ["staging CSS is served from reviewed snapshot", candidate.includes("const PREVIEW_STYLES_CSS = " + JSON.stringify(css) + ";") && candidate.includes('pathname === "/styles.css"') && candidate.includes("PREVIEW_STYLES_CSS")],
  ["served preview frontend exactly matches reviewed site snapshot", candidate.includes("const PREVIEW_FRONTEND_SCRIPT = " + JSON.stringify(frontend) + ";")],
  ["old no-verification disclaimer removed", !html.includes("chưa xác minh email")]
];

for (const [name, pass] of checks) console.log((pass ? "PASS " : "FAIL ") + name);
assert.ok(checks.every(([, pass]) => pass), "Email-verification candidate checks failed.");

const token = Buffer.alloc(32, 0x5a).toString("base64url");
assert.match(token, /^[A-Za-z0-9_-]{32,80}$/);
for (const origin of [
  "https://ai-thuc-chien-blog.manhdungub.workers.dev",
  "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev"
]) {
  const link = new URL("/", origin);
  link.hash = "cong-dong?verify=" + token;
  assert.equal(link.origin, origin);
  assert.equal(link.pathname, "/");
  assert.equal(link.search, "", "verification token must not be sent in the HTTP query string");
  assert.equal(link.hash, "#cong-dong?verify=" + token);
  assert.equal(new URLSearchParams(link.hash.slice(link.hash.indexOf("?") + 1)).get("verify"), token);
}
for (const origin of [
  "https://ai-thuc-chien-blog.manhdungub.workers.dev",
  "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev"
]) {
  const resetLink = new URL("/", origin);
  resetLink.hash = "cong-dong?reset=" + token;
  assert.equal(resetLink.search, "", "password reset token must not be sent in the HTTP query string");
  assert.equal(resetLink.hash, "#cong-dong?reset=" + token);
}
console.log("PASS verification and reset URL formats keep bearer tokens in fragments.");
console.log("All email-verification candidate assertions passed: " + checks.length + " checks.");
