import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const code = await readFile(new URL("../email-relay/Code.gs", import.meta.url), "utf8");
const expectedSecret = "x".repeat(40);
const token = Buffer.alloc(32, 0x5a).toString("base64url");
const stagingHost = "ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const productionHost = "ai-thuc-chien-blog.manhdungub.workers.dev";
const verifyUrl = "https://" + stagingHost + "/#cong-dong?verify=" + token;
const resetUrl = "https://" + stagingHost + "/#cong-dong?reset=" + token;
const legacyVerifyUrl = "https://" + stagingHost + "/?verify=" + token + "#cong-dong";
const stagingAllowedHosts = stagingHost;
const productionAllowedHosts = productionHost;

function makeRelay(options = {}) {
  const props = options.props || {};
  const sent = [];
  const quota = options.quota === undefined ? 10 : options.quota;
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => props[key] || "" }) },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail: (message) => {
        if (options.throwOnSend) throw new Error("simulated send failure");
        sent.push(message);
      },
    },
  };
  runInNewContext(code, sandbox);
  return { doGet: sandbox.doGet, doPost: sandbox.doPost, sent };
}
function event(payload) {
  return { postData: { contents: typeof payload === "string" ? payload : JSON.stringify(payload) } };
}
function read(response) { return JSON.parse(response.text); }
function payload(overrides = {}) {
  return {
    secret: expectedSecret,
    to: "test@example.invalid",
    subject: "Confirm test account",
    textBody: "Confirm your email: " + verifyUrl,
    htmlBody: '<p><a href="' + verifyUrl + '">Confirm email</a></p>',
    verifyUrl,
    ...overrides,
  };
}
function pass(name, condition) { assert.ok(condition, name); console.log("PASS " + name); }

const notConfigured = makeRelay();
const r0 = read(notConfigured.doPost(event(payload())));
pass("missing secret fails closed", r0.code === "RELAY_NOT_CONFIGURED" && notConfigured.sent.length === 0);

const secretOnly = makeRelay({ props: { COMMUNITY_EMAIL_RELAY_SECRET: expectedSecret } });
const noAllowlistResult = read(secretOnly.doPost(event(payload())));
pass("missing host allowlist rejects verification email fail-closed", noAllowlistResult.code === "INVALID_MESSAGE" && secretOnly.sent.length === 0);

const malformedJson = makeRelay({ props: { COMMUNITY_EMAIL_RELAY_SECRET: expectedSecret, COMMUNITY_EMAIL_ALLOWED_HOSTS: stagingAllowedHosts } });
const malformedResult = read(malformedJson.doPost(event("{broken-json")));
pass("malformed JSON fails closed without sending", malformedResult.code === "INVALID_REQUEST" && malformedJson.sent.length === 0 && !JSON.stringify(malformedResult).includes(expectedSecret));

const oversizedPayload = makeRelay({ props: { COMMUNITY_EMAIL_RELAY_SECRET: expectedSecret, COMMUNITY_EMAIL_ALLOWED_HOSTS: stagingAllowedHosts } });
const oversizedResult = read(oversizedPayload.doPost(event("x".repeat(25001))));
pass("oversized raw payload is rejected without sending", oversizedResult.code === "INVALID_REQUEST" && oversizedPayload.sent.length === 0);

const stagingProps = { COMMUNITY_EMAIL_RELAY_SECRET: expectedSecret, COMMUNITY_EMAIL_ALLOWED_HOSTS: stagingAllowedHosts };
const productionProps = { COMMUNITY_EMAIL_RELAY_SECRET: expectedSecret, COMMUNITY_EMAIL_ALLOWED_HOSTS: productionAllowedHosts };
const wrongSecret = makeRelay({ props: stagingProps });
const r1 = read(wrongSecret.doPost(event(payload({ secret: "wrong" }))));
pass("wrong shared secret is rejected", r1.code === "UNAUTHORIZED" && wrongSecret.sent.length === 0);

const wrongHost = makeRelay({ props: stagingProps });
const evilUrl = "https://evil.example/#cong-dong?verify=" + token;
const r2 = read(wrongHost.doPost(event(payload({ verifyUrl: evilUrl, textBody: evilUrl, htmlBody: '<a href="' + evilUrl + '">x</a>' }))));
pass("unapproved verification host is rejected", r2.code === "INVALID_MESSAGE" && wrongHost.sent.length === 0);

const productionUrl = "https://" + productionHost + "/#cong-dong?verify=" + token;
const stagingBlocksProductionHost = makeRelay({ props: stagingProps });
const rProductionInStaging = read(stagingBlocksProductionHost.doPost(event(payload({ verifyUrl: productionUrl, textBody: productionUrl, htmlBody: '<a href="' + productionUrl + '">x</a>' }))));
pass("staging relay rejects production verification links", rProductionInStaging.code === "INVALID_MESSAGE" && stagingBlocksProductionHost.sent.length === 0);

const productionBlocksStagingHost = makeRelay({ props: productionProps });
const rStagingInProduction = read(productionBlocksStagingHost.doPost(event(payload())));
pass("production relay rejects staging verification links", rStagingInProduction.code === "INVALID_MESSAGE" && productionBlocksStagingHost.sent.length === 0);

const suffixUrl = "https://" + stagingHost + ".evil.example/#cong-dong?verify=" + token;
const suffixHost = makeRelay({ props: stagingProps });
const rSuffix = read(suffixHost.doPost(event(payload({ verifyUrl: suffixUrl, textBody: suffixUrl, htmlBody: '<a href="' + suffixUrl + '">x</a>' }))));
pass("hostname suffix spoof is rejected", rSuffix.code === "INVALID_MESSAGE" && suffixHost.sent.length === 0);

const inconsistentBody = makeRelay({ props: stagingProps });
const rBodyMismatch = read(inconsistentBody.doPost(event(payload({
  textBody: "Do not follow this unverified link: https://evil.example/phishing",
  htmlBody: '<p><a href="https://evil.example/phishing">Continue</a></p>',
}))));
pass("text and HTML bodies must include the approved verification URL", rBodyMismatch.code === "INVALID_MESSAGE" && inconsistentBody.sent.length === 0);

const htmlMismatch = makeRelay({ props: { COMMUNITY_EMAIL_RELAY_SECRET: expectedSecret, COMMUNITY_EMAIL_ALLOWED_HOSTS: stagingAllowedHosts } });
const rHtmlMismatch = read(htmlMismatch.doPost(event(payload({ htmlBody: '<a href="https://evil.example/phishing">Confirm email</a>' }))));
pass("approved text URL cannot mask an unsafe HTML link", rHtmlMismatch.code === "INVALID_MESSAGE" && htmlMismatch.sent.length === 0);

const textMismatch = makeRelay({ props: { COMMUNITY_EMAIL_RELAY_SECRET: expectedSecret, COMMUNITY_EMAIL_ALLOWED_HOSTS: stagingAllowedHosts } });
const rTextMismatch = read(textMismatch.doPost(event(payload({ textBody: "https://evil.example/phishing" }))));
pass("approved HTML URL cannot mask an unsafe text link", rTextMismatch.code === "INVALID_MESSAGE" && textMismatch.sent.length === 0);

const extraHtmlLink = makeRelay({ props: stagingProps });
const rExtraHtmlLink = read(extraHtmlLink.doPost(event(payload({
  htmlBody: '<p><a href="' + verifyUrl + '">Confirm</a></p><p><a href="https://evil.example/track">More</a></p>',
}))));
pass("additional unapproved HTML link is rejected", rExtraHtmlLink.code === "INVALID_MESSAGE" && extraHtmlLink.sent.length === 0);

const externalImage = makeRelay({ props: stagingProps });
const rExternalImage = read(externalImage.doPost(event(payload({
  htmlBody: '<p><a href="' + verifyUrl + '">Confirm</a><img src="https://evil.example/pixel"></p>',
}))));
pass("external HTML resource URL is rejected", rExternalImage.code === "INVALID_MESSAGE" && externalImage.sent.length === 0);

const formAction = makeRelay({ props: stagingProps });
const rFormAction = read(formAction.doPost(event(payload({
  htmlBody: '<p><a href="' + verifyUrl + '">Confirm</a></p><form action="javascript:alert(1)"><button>Continue</button></form>',
}))));
pass("HTML form action is rejected", rFormAction.code === "INVALID_MESSAGE" && formAction.sent.length === 0);

const cssExternalResource = makeRelay({ props: stagingProps });
const rCssExternalResource = read(cssExternalResource.doPost(event(payload({
  htmlBody: '<p><a href="' + verifyUrl + '">Confirm</a></p><div style="background:url(https://evil.example/pixel)"></div>',
}))));
pass("CSS external resource URL is rejected", rCssExternalResource.code === "INVALID_MESSAGE" && cssExternalResource.sent.length === 0);

const extraTextUrl = makeRelay({ props: stagingProps });
const rExtraTextUrl = read(extraTextUrl.doPost(event(payload({
  textBody: "Confirm: " + verifyUrl + "\\nMore info: https://evil.example/phishing",
}))));
pass("additional unapproved text URL is rejected", rExtraTextUrl.code === "INVALID_MESSAGE" && extraTextUrl.sent.length === 0);


const invalidToken = makeRelay({ props: stagingProps });
const badUrl = "https://" + stagingHost + "/#cong-dong?verify=short";
const r3 = read(invalidToken.doPost(event(payload({ verifyUrl: badUrl, textBody: badUrl, htmlBody: '<a href="' + badUrl + '">x</a>' }))));
pass("malformed verification token is rejected", r3.code === "INVALID_MESSAGE" && invalidToken.sent.length === 0);

const invalidEmail = makeRelay({ props: stagingProps });
const r4 = read(invalidEmail.doPost(event(payload({ to: "not-an-email" }))));
pass("invalid recipient is rejected", r4.code === "INVALID_MESSAGE" && invalidEmail.sent.length === 0);

const noQuota = makeRelay({ props: stagingProps, quota: 0 });
const r5 = read(noQuota.doPost(event(payload())));
pass("daily email quota is checked", r5.code === "DAILY_QUOTA_EXHAUSTED" && noQuota.sent.length === 0);

const sendError = makeRelay({ props: stagingProps, throwOnSend: true });
const r6 = read(sendError.doPost(event(payload())));
pass("send exceptions return safe failure", r6.code === "SEND_FAILED" && sendError.sent.length === 0);

const valid = makeRelay({ props: stagingProps });
const r7 = read(valid.doPost(event(payload())));
pass("valid fragment-only request sends exactly one email", r7.ok === true && valid.sent.length === 1);

const legacyValid = makeRelay({ props: stagingProps });
const rLegacy = read(legacyValid.doPost(event(payload({
  verifyUrl: legacyVerifyUrl,
  textBody: "Confirm your email: " + legacyVerifyUrl,
  htmlBody: '<p><a href="' + legacyVerifyUrl + '">Confirm email</a></p>',
}))));
pass("legacy query-style confirmation URL remains accepted during staging rollout", rLegacy.ok === true && legacyValid.sent.length === 1);
pass("email payload has fixed sender name and expected recipient", valid.sent[0].name === "AI Thực Chiến" && valid.sent[0].to === "test@example.invalid");
pass("staging and production allowlists are strictly separated", stagingAllowedHosts === stagingHost && productionAllowedHosts === productionHost && !stagingAllowedHosts.includes(productionHost) && !productionAllowedHosts.includes(stagingHost));

const combinedAllowedHosts = stagingHost + ", " + productionHost;
const combinedHostRelay = makeRelay({ props: {
  COMMUNITY_EMAIL_RELAY_SECRET: expectedSecret,
  COMMUNITY_EMAIL_ALLOWED_HOSTS: combinedAllowedHosts,
} });
const combinedStagingResult = read(combinedHostRelay.doPost(event(payload())));
const combinedProductionUrl = "https://" + productionHost + "/#cong-dong?verify=" + token;
const combinedProductionResult = read(combinedHostRelay.doPost(event(payload({
  verifyUrl: combinedProductionUrl,
  textBody: "Confirm your email: " + combinedProductionUrl,
  htmlBody: '<p><a href="' + combinedProductionUrl + '">Confirm email</a></p>',
}))));
pass("comma-separated allowlist accepts the exact staging and production hostnames", combinedStagingResult.ok === true && combinedProductionResult.ok === true && combinedHostRelay.sent.length === 2);


const validReset = makeRelay({ props: stagingProps });
const resetResult = read(validReset.doPost(event(payload({
  subject: "Đặt lại mật khẩu — AI Thực Chiến",
  verifyUrl: resetUrl,
  textBody: "Tạo mật khẩu mới: " + resetUrl,
  htmlBody: '<p><a href="' + resetUrl + '">Đặt lại mật khẩu</a></p>',
}))));
pass("valid password-reset fragment link is accepted", resetResult.ok === true && validReset.sent.length === 1);
const legacyResetUrl = "https://" + stagingHost + "/?reset=" + token + "#cong-dong";
const legacyReset = makeRelay({ props: stagingProps });
const legacyResetResult = read(legacyReset.doPost(event(payload({
  verifyUrl: legacyResetUrl,
  textBody: "Reset: " + legacyResetUrl,
  htmlBody: '<p><a href="' + legacyResetUrl + '">Reset</a></p>',
}))));
pass("query-string password-reset link is rejected", legacyResetResult.code === "INVALID_MESSAGE" && legacyReset.sent.length === 0);

const legacyProductionUrl = "https://" + productionHost + "/api/community/verify?token=" + token;
const legacyProductionRelay = makeRelay({ props: productionProps });
const legacyProductionResult = read(legacyProductionRelay.doPost(event(payload({
  verifyUrl: legacyProductionUrl,
  textBody: "Confirm your email: " + legacyProductionUrl,
  htmlBody: '<p><a href="' + legacyProductionUrl + '">Confirm email</a></p>',
}))));
pass("legacy version-175 /api/community/verify?token URL is rejected by the current relay contract", legacyProductionResult.code === "INVALID_MESSAGE" && legacyProductionRelay.sent.length === 0);

console.log("All Apps Script relay tests passed in a VM with mocked Google services. No email was sent.");
