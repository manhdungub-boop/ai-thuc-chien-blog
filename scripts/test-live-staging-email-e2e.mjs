import assert from "node:assert/strict";

const ORIGIN = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const action = process.argv[2];

function required(name) {
  const value = String(process.env[name] || "").trim();
  assert.ok(value, "Required CI variable is missing: " + name + ".");
  return value;
}

function validateTestEmail(email) {
  assert.match(
    email,
    /^manhdungub\+staging-e2e-[a-z0-9-]+@gmail\.com$/i,
    "STAGING_E2E_EMAIL must be a unique plus-alias for the project's own Gmail mailbox."
  );
}

function testEmailForCurrentPipeline() {
  const base = required("STAGING_E2E_EMAIL");
  validateTestEmail(base);
  const pipelineId = String(process.env.CI_PIPELINE_ID || "").replace(/[^0-9]/g, "").slice(-12);
  assert.ok(pipelineId, "CI_PIPELINE_ID is required to keep the same disposable email across E2E jobs in one pipeline.");
  const localPart = base.slice(0, base.lastIndexOf("@"));
  assert.ok(localPart.length + pipelineId.length + 1 <= 64,
    "STAGING_E2E_EMAIL local part is too long to add a pipeline-specific suffix.");
  const email = localPart + "-" + pipelineId + "@gmail.com";
  return email;
}

function validateToken(token, name) {
  assert.match(token, /^[A-Za-z0-9_-]{32,80}$/, name + " is not in the expected opaque token format.");
}

function validatePassword(password, name) {
  assert.ok(password.length >= 14 && password.length <= 128, name + " must be 14–128 characters.");
  assert.ok(/[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password),
    name + " must include upper/lowercase letters and digits.");
}

async function post(path, body) {
  const response = await fetch(new URL(path, ORIGIN), {
    method: "POST",
    redirect: "error",
    headers: {
      Origin: ORIGIN,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

function safeRegistrationFailure(result) {
  const payload = result.payload && typeof result.payload === "object" ? result.payload : {};
  const code = typeof payload.code === "string" && /^[A-Z0-9_-]{1,48}$/.test(payload.code)
    ? payload.code
    : "NOT_PROVIDED";
  const knownErrors = new Map([
    ["Email hoặc tên thành viên đã được sử dụng.", "EMAIL_OR_USERNAME_CONFLICT"],
    ["Dịch vụ xác nhận email chưa được cấu hình. Tài khoản chưa được tạo; vui lòng thử lại sau.", "EMAIL_RELAY_NOT_CONFIGURED"],
    ["Chức năng xác nhận email chưa được cấu hình. Vui lòng thử lại sau.", "EMAIL_RELAY_NOT_CONFIGURED"],
    ["Không thể gửi email xác nhận. Tài khoản chưa được tạo; vui lòng thử lại sau.", "EMAIL_RELAY_FAILED"],
    ["Chưa gửi được email xác nhận. Tài khoản chưa được tạo; vui lòng thử lại sau.", "EMAIL_RELAY_FAILED"],
    ["Nguồn yêu cầu không được phép.", "ORIGIN_NOT_ALLOWED"],
    ["Bạn đã thử đăng ký quá nhiều lần. Vui lòng thử lại sau một giờ.", "REGISTRATION_RATE_LIMITED"],
  ]);
  const reason = knownErrors.get(typeof payload.error === "string" ? payload.error : "") || "UNCLASSIFIED_RESPONSE";
  const contentType = result.response.headers.get("content-type") || "none";
  const hasCfRay = result.response.headers.has("cf-ray");
  const hasJsonPayload = Boolean(result.payload && typeof result.payload === "object");
  return "HTTP " + result.response.status + "; content_type=" + contentType + "; cf_ray=" + hasCfRay + "; json_payload=" + hasJsonPayload + "; code=" + code + "; reason=" + reason;
}

function assertJsonSuccess(result, expectedStatus, label) {
  assert.equal(result.response.status, expectedStatus, label + " returned unexpected HTTP status " + result.response.status + ".");
  assert.ok(result.payload && typeof result.payload === "object", label + " did not return JSON.");
  assert.equal(result.payload.ok, true, label + " did not return ok=true.");
}

function assertLoginSuccess(result, expectedStatus, label) {
  assert.equal(result.response.status, expectedStatus, label + " returned unexpected HTTP status " + result.response.status + ".");
  assert.ok(result.payload && typeof result.payload === "object", label + " did not return JSON.");
  assert.ok(result.payload.member && typeof result.payload.member === "object",
    label + " did not return a member object.");
  assert.ok(typeof result.payload.member.username === "string" && result.payload.member.username.length > 0,
    label + " did not return a valid member username.");
}

assert.equal(
  ORIGIN,
  "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev",
  "This live test must target the isolated staging Worker only."
);

if (action === "register") {
  const email = testEmailForCurrentPipeline();
  const password = required("STAGING_E2E_PASSWORD");
  validatePassword(password, "STAGING_E2E_PASSWORD");
  const suffix = (process.env.CI_JOB_ID || String(Date.now())).replace(/[^0-9]/g, "").slice(-12);
  const result = await post("/api/community/register", {
    username: "stge2e" + suffix,
    displayName: "Staging E2E Disposable",
    email,
    password,
  });
  assert.equal(result.response.status, 201, "Registration did not return verification-required HTTP 201; " + safeRegistrationFailure(result) + ".");
  assert.ok(result.payload && result.payload.verificationRequired === true,
    "Registration did not report verificationRequired=true.");
  assert.equal(result.response.headers.get("set-cookie"), null,
    "Pending registration must not create a login session.");
  console.log("PASS: a disposable staging registration was accepted and the confirmation email was requested.");
} else if (action === "confirm") {
  const email = testEmailForCurrentPipeline();
  const password = required("STAGING_E2E_PASSWORD");
  const token = required("STAGING_E2E_VERIFY_TOKEN");
  validatePassword(password, "STAGING_E2E_PASSWORD");
  validateToken(token, "STAGING_E2E_VERIFY_TOKEN");
  assertJsonSuccess(await post("/api/community/verify-email", { token }), 200, "Email confirmation");
  assertLoginSuccess(await post("/api/community/login", { email, password }), 200, "Login after email confirmation");
  console.log("PASS: the live email-confirmation token was accepted once and login works after confirmation.");
} else if (action === "request-reset") {
  const email = testEmailForCurrentPipeline();
  const result = await post("/api/community/password-reset/request", { email });
  assertJsonSuccess(result, 200, "Password-reset request");
  assert.ok(typeof result.payload.message === "string" &&
    result.payload.message.includes("Nếu email này có tài khoản hợp lệ"),
    "Password-reset request must return the generic public response.");
  console.log("PASS: the password-reset request returned its generic response and was submitted to the staging relay.");
} else if (action === "finish-reset") {
  const email = testEmailForCurrentPipeline();
  const oldPassword = required("STAGING_E2E_PASSWORD");
  const newPassword = required("STAGING_E2E_NEW_PASSWORD");
  const token = required("STAGING_E2E_RESET_TOKEN");
  validatePassword(oldPassword, "STAGING_E2E_PASSWORD");
  validatePassword(newPassword, "STAGING_E2E_NEW_PASSWORD");
  assert.notEqual(newPassword, oldPassword, "The replacement password must differ from the old password.");
  validateToken(token, "STAGING_E2E_RESET_TOKEN");
  assertJsonSuccess(await post("/api/community/password-reset/complete", { token, password: newPassword }), 200, "Password reset");
  const oldLogin = await post("/api/community/login", { email, password: oldPassword });
  assert.equal(oldLogin.response.status, 401, "The previous password must be rejected with HTTP 401 after reset.");
  assertLoginSuccess(await post("/api/community/login", { email, password: newPassword }), 200, "Login with replacement password");
  console.log("PASS: the live reset token was accepted; the old password was rejected and the replacement password works.");
} else {
  throw new Error("Unknown action. Use register, confirm, request-reset, or finish-reset.");
}

console.log("Safety: no tokens, passwords, response bodies, or mailbox address were printed. Only the isolated staging Worker was contacted.");



