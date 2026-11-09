import assert from "node:assert/strict";
import { chromium } from "playwright";

const ORIGIN = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const unexpectedMethods = [];
const pageErrors = [];

page.on("pageerror", error => pageErrors.push(error.name));
await context.route("**/*", async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== ORIGIN) {
    await route.abort();
    return;
  }
  if (!["GET", "HEAD"].includes(request.method())) {
    unexpectedMethods.push(request.method() + " " + url.pathname);
    await route.abort();
    return;
  }
  await route.continue();
});

try {
  const home = await page.goto(ORIGIN + "/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  assert.equal(home?.status(), 200, "Preview homepage must return HTTP 200.");
  assert.match(home.headers()["content-type"] || "", /text\/html/i);

  await page.locator("#community-auth-form").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.locator("#community-auth-submit").isVisible(), true,
    "Community registration/login submit control must render.");
  assert.equal(await page.locator("#community-verify-confirm").isHidden(), true,
    "Email verification action must remain hidden without a verification token.");
  assert.equal(await page.locator("#community-password-reset-form").isHidden(), true,
    "Password reset form must remain hidden without a reset token.");

  await page.waitForFunction(() => {
    const button = document.querySelector(".community-social-button");
    return button && !button.hidden;
  }, { timeout: 15000 });
  const googleButton = page.locator(".community-social-button");
  assert.equal(await googleButton.isVisible(), true, "Configured Google sign-in control must render.");
  assert.equal(await googleButton.getAttribute("href"), "/api/community/oauth/google/start",
    "Google sign-in must target the same Preview origin.");

  const js = await context.request.get(ORIGIN + "/script.js", { timeout: 15000 });
  assert.equal(js.status(), 200, "Preview script.js must return HTTP 200.");
  const jsText = await js.text();
  assert.ok(jsText.includes("/oauth/providers"), "Frontend must load OAuth provider readiness.");
  assert.equal(await page.locator("#reader-ai-chat").count(), 0,
    "Production-only reader assistant must not render inside the isolated Preview.");

  const css = await context.request.get(ORIGIN + "/styles.css", { timeout: 15000 });
  assert.equal(css.status(), 200, "Preview styles.css must return HTTP 200.");

  const providersResponse = await context.request.get(ORIGIN + "/api/community/oauth/providers", {
    timeout: 15000,
    headers: { Accept: "application/json", "Cache-Control": "no-store" },
  });
  assert.equal(providersResponse.status(), 200, "OAuth provider status endpoint must return HTTP 200.");
  const providers = await providersResponse.json();
  assert.equal(providers.google, true, "Google OAuth must be configured on the isolated Preview.");
  assert.equal(providers.facebook, false, "Facebook OAuth must remain disabled.");

  const meResponse = await context.request.get(ORIGIN + "/api/community/me", {
    timeout: 15000,
    headers: { Accept: "application/json", "Cache-Control": "no-store" },
  });
  assert.equal(meResponse.status(), 200, "Unauthenticated /me endpoint must return HTTP 200.");
  const me = await meResponse.json();
  assert.equal(me.member, null, "Fresh isolated browser context must have no authenticated member.");

  assert.deepEqual(unexpectedMethods, [], "Read-only smoke test must not issue POST/PUT/PATCH/DELETE requests.");
  assert.deepEqual(pageErrors, [], "Preview frontend must not raise uncaught page errors.");

  console.log("PASS: Chromium loaded the live isolated Preview at a mobile viewport.");
  console.log("PASS: registration UI, hidden verification/reset states, and configured Google sign-in rendered.");
  console.log("PASS: Preview JS/CSS and read-only OAuth provider/session endpoints responded correctly.");
  console.log("SAFETY: only same-origin GET/HEAD requests were allowed; no form was submitted, no OAuth flow started, no account/session/data was created or changed, no email was sent, and Production was not contacted.");
} finally {
  await context.close();
  await browser.close();
}
