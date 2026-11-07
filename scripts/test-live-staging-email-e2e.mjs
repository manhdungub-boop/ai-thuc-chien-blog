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

function testEmailForPipelineId(rawPipelineId) {
  const base = required("STAGING_E2E_EMAIL");
  validateTestEmail(base);
  const pipelineId = String(rawPipelineId || "").replace(/[^0-9]/g, "").slice(-12);
  assert.ok(pipelineId, "A valid registration run ID is required to derive the disposable test email.");
  const localPart = base.slice(0, base.lastIndexOf("@"));
  assert.ok(localPart.length + pipelineId.length + 1 <= 64,
    "STAGING_E2E_EMAIL local part is too long to add a pipeline-specific suffix.");
  return localPart + "-" + pipelineId + "@gmail.com";
}

function testEmailForCurrentPipeline() {
  return testEmailForPipelineId(process.env.CI_PIPELINE_ID);
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
} else if (action === "login") {
  const email = testEmailForCurrentPipeline();
  const password = required("STAGING_E2E_PASSWORD");
  validatePassword(password, "STAGING_E2E_PASSWORD");
  const result = await post("/api/community/login", { email, password });
  assertLoginSuccess(result, 200, "Staging login");
  console.log("PASS: the previously confirmed disposable staging account can log in.");
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
} else if (action === "ownership") {
  const firstEmail = testEmailForPipelineId(process.env.CI_PIPELINE_ID);
  const secondEmail = testEmailForPipelineId(required("STAGING_E2E_OTHER_PIPELINE_ID"));
  const password = required("STAGING_E2E_PASSWORD");
  validatePassword(password, "STAGING_E2E_PASSWORD");

  async function loginAndGetCookie(email) {
    const result = await post("/api/community/login", { email, password });
    assertLoginSuccess(result, 200, "Staging ownership-test login");
    const setCookie = result.response.headers.get("set-cookie") || "";
    const cookie = setCookie.split(";")[0];
    assert.match(cookie, /^__Host-ai_community=[A-Za-z0-9_-]{32,100}$/,
      "Login did not return the expected secure community session cookie.");
    return cookie;
  }

  async function requestAsMember(path, method, cookie, body) {
    const response = await fetch(new URL(path, ORIGIN), {
      method,
      redirect: "error",
      headers: {
        Origin: ORIGIN,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Cookie: cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { response, payload };
  }

  const cookieA = await loginAndGetCookie(firstEmail);
  const cookieB = await loginAndGetCookie(secondEmail);
  const marker = "STAGING E2E ownership check " + String(process.env.CI_JOB_ID || Date.now()).replace(/[^0-9]/g, "");
  let messageId = "";
  try {
    const created = await requestAsMember("/api/community/messages", "POST", cookieB, { topic: "tools", body: marker });
    assert.equal(created.response.status, 201, "Member B could not create the temporary ownership-test message.");
    assert.ok(typeof created.payload?.message?.id === "string" && /^[0-9a-f-]{36}$/i.test(created.payload.message.id),
      "Message creation did not return a valid message ID.");
    messageId = created.payload.message.id;

    const crossDelete = await requestAsMember("/api/community/messages/" + messageId, "DELETE", cookieA);
    assert.equal(crossDelete.response.status, 404, "Member A must not be able to delete Member B's message.");
    assert.equal(crossDelete.payload?.error, "Không tìm thấy tin nhắn hoặc bạn không có quyền xóa.",
      "Cross-member deletion did not return the expected ownership-denial response.");

    const visibleToOwner = await requestAsMember("/api/community/messages?topic=tools", "GET", cookieB);
    assert.equal(visibleToOwner.response.status, 200, "Member B could not read the discussion after the denied cross-delete.");
    assert.ok(Array.isArray(visibleToOwner.payload?.messages) &&
      visibleToOwner.payload.messages.some((item) => item.id === messageId && item.body === marker),
      "Member B's message disappeared after Member A's denied delete attempt.");

    const ownDelete = await requestAsMember("/api/community/messages/" + messageId, "DELETE", cookieB);
    assert.equal(ownDelete.response.status, 200, "Member B could not delete their own temporary test message.");
    assert.equal(ownDelete.payload?.ok, true, "Member B's own deletion did not return ok=true.");
    messageId = "";
    console.log("PASS: cross-member delete denied (HTTP 404); owner retained visibility and successfully deleted own test message.");
  } finally {
    if (messageId) {
      await requestAsMember("/api/community/messages/" + messageId, "DELETE", cookieB).catch(() => {});
    }
  }

} else if (action === "session") {
  const email = testEmailForCurrentPipeline();
  const password = required("STAGING_E2E_PASSWORD");
  validatePassword(password, "STAGING_E2E_PASSWORD");

  const login = await post("/api/community/login", { email, password });
  assertLoginSuccess(login, 200, "Staging session login");
  const setCookie = login.response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  assert.match(cookie, /^__Host-ai_community=[A-Za-z0-9_-]{32,100}$/,
    "Login did not return the expected secure session cookie.");
  assert.match(setCookie, /HttpOnly/i, "Session cookie must be HttpOnly.");
  assert.match(setCookie, /Secure/i, "Session cookie must be Secure.");
  assert.match(setCookie, /SameSite=Lax/i, "Session cookie must use SameSite=Lax.");
  assert.match(setCookie, /Path=\//i, "Session cookie must be scoped to root path.");

  async function requestWithCookie(path, method, body) {
    const response = await fetch(new URL(path, ORIGIN), {
      method,
      redirect: "error",
      headers: {
        Origin: ORIGIN,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Cookie: cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { response, payload };
  }

  const meBefore = await requestWithCookie("/api/community/me", "GET");
  assert.equal(meBefore.response.status, 200, "/me must return HTTP 200 for an authenticated member.");
  assert.equal(meBefore.payload?.member?.username, login.payload.member.username,
    "/me must resolve the same member as the login response.");

  const logout = await requestWithCookie("/api/community/logout", "POST", {});
  assert.equal(logout.response.status, 200, "Logout must return HTTP 200.");
  assert.equal(logout.payload?.ok, true, "Logout must return ok=true.");
  const cleared = logout.response.headers.get("set-cookie") || "";
  assert.match(cleared, /Max-Age=0/i, "Logout must expire the session cookie.");
  assert.match(cleared, /HttpOnly/i, "Logout expiry cookie must remain HttpOnly.");
  assert.match(cleared, /Secure/i, "Logout expiry cookie must remain Secure.");

  const meAfter = await requestWithCookie("/api/community/me", "GET");
  assert.equal(meAfter.response.status, 200, "/me should remain a safe public session-status endpoint after logout.");
  assert.equal(meAfter.payload?.member, null, "The old session cookie must no longer resolve a member after logout.");

  const messagesAfter = await requestWithCookie("/api/community/messages?topic=tools", "GET");
  assert.equal(messagesAfter.response.status, 401, "A logged-out session must not read community messages.");
  const postAfter = await requestWithCookie("/api/community/messages", "POST", { topic: "tools", body: "must not be created" });
  assert.equal(postAfter.response.status, 401, "A logged-out session must not create community messages.");
  const deleteAfter = await requestWithCookie("/api/community/messages/00000000-0000-4000-8000-000000000000", "DELETE");
  assert.equal(deleteAfter.response.status, 401, "A logged-out session must not delete community messages.");

  const logoutAgain = await requestWithCookie("/api/community/logout", "POST", {});
  assert.equal(logoutAgain.response.status, 200, "Repeated logout must be safe and idempotent.");
  assert.equal(logoutAgain.payload?.ok, true, "Repeated logout must return ok=true.");
  console.log("PASS: secure session cookie; /me authenticated; logout revokes session; old cookie denied message GET/POST/DELETE; repeated logout is safe.");

} else if (action === "cors") {
  const allowed = await fetch(new URL("/api/community/messages", ORIGIN), {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(allowed.status, 200, "Preview origin preflight must return HTTP 200.");
  assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN,
    "Preflight must echo only the approved Preview origin.");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true",
    "Preflight must allow credentials for the approved Preview origin.");
  assert.match(allowed.headers.get("access-control-allow-methods") || "", /POST/);
  assert.match(allowed.headers.get("access-control-allow-headers") || "", /Content-Type/i);
  assert.equal(allowed.headers.get("access-control-max-age"), "86400");

  const rejected = await fetch(new URL("/api/community/messages", ORIGIN), {
    method: "OPTIONS",
    headers: {
      Origin: "https://untrusted.invalid",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(rejected.status, 403, "An unapproved origin must be rejected with HTTP 403.");
  assert.equal(rejected.headers.get("access-control-allow-origin"), null,
    "An unapproved origin must not receive Access-Control-Allow-Origin.");
  assert.equal(rejected.headers.get("access-control-allow-credentials"), null,
    "An unapproved origin must not receive credentialed CORS permission.");
  console.log("PASS: Preview CORS preflight allows only the approved Preview origin and rejects an untrusted origin.");

} else {
  throw new Error("Unknown action. Use register, confirm, login, session, cors, ownership, request-reset, or finish-reset.");
}

console.log("Safety: no tokens, passwords, response bodies, or mailbox address were printed. Only the isolated staging Worker was contacted.");



