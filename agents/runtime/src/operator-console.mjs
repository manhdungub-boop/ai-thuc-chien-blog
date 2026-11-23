export const OPERATOR_CONSOLE_HTML = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Điều khiển AI Agent | DUNG - AI</title>
</head>
<body>
  <main>
    <h1>Điều khiển AI Agent Runtime</h1>
    <p>Preview riêng biệt · Bảng điều khiển operator · Không có quyền xuất bản hoặc triển khai Production</p>
    <p id="session-status" role="status">Đang kiểm tra phiên đăng nhập…</p>
    <p>
      <a id="login-link" href="/auth/google/start?return_to=%2Foperator-console">Đăng nhập Google</a>
      <button id="logout-button" type="button" hidden>Đăng xuất</button>
      <button id="refresh-button" type="button">Làm mới trạng thái</button>
    </p>
    <section aria-labelledby="runtime-heading">
      <h2 id="runtime-heading">Trạng thái runtime</h2>
      <p id="runtime-status" role="status">Chưa tải trạng thái.</p>
      <ul id="runtime-details"></ul>
    </section>
    <section aria-labelledby="control-heading">
      <h2 id="control-heading">Điều khiển an toàn</h2>
      <p>Pause sẽ chặn nhận và claim task. Resume chỉ xóa trạng thái pause bền vững của Task Store; không vượt qua cờ AGENT_ENABLED hoặc AGENT_PAUSED của cấu hình triển khai.</p>
      <label for="control-reason">Lý do thao tác (tối thiểu 12 ký tự)</label>
      <textarea id="control-reason" rows="3" maxlength="160" disabled></textarea>
      <p>
        <button id="pause-button" type="button" disabled>Pause task queue</button>
        <button id="resume-button" type="button" disabled>Resume circuit breaker</button>
      </p>
      <p id="action-status" role="status">Chưa có thao tác nào.</p>
    </section>
  </main>
  <script src="/operator-console.js" defer></script>
</body>
</html>`;

export const OPERATOR_CONSOLE_JS = `"use strict";
(() => {
  const byId = id => document.getElementById(id);
  const status = byId("session-status");
  const runtimeStatus = byId("runtime-status");
  const runtimeDetails = byId("runtime-details");
  const reasonInput = byId("control-reason");
  const pauseButton = byId("pause-button");
  const resumeButton = byId("resume-button");
  const actionStatus = byId("action-status");
  const login = byId("login-link");
  const logout = byId("logout-button");
  let operatorAuthorized = false;
  let actionInProgress = false;
  let refreshSequence = 0;

  function node(tag, value) {
    const element = document.createElement(tag);
    if (value !== undefined && value !== null) element.textContent = String(value);
    return element;
  }

  function add(parent, tag, value) {
    const element = node(tag, value);
    parent.append(element);
    return element;
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        accept: "application/json",
        ...(options.headers || {})
      }
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload.error || "request_failed");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setControlsEnabled(enabled) {
    const canAct = enabled && !actionInProgress;
    reasonInput.disabled = !canAct;
    pauseButton.disabled = !canAct;
    resumeButton.disabled = !canAct;
  }

  function renderRuntime(health, operator) {
    const control = operator.control;
    const admission = operator.health?.task_admission;
    const admissionText = admission?.available === true && Number.isSafeInteger(admission.accepted_today) &&
      Number.isSafeInteger(admission.daily_limit)
      ? admission.accepted_today + " / " + admission.daily_limit
      : "Unavailable";
    runtimeDetails.replaceChildren();
    const items = [
      ["Environment enabled", health.enabled],
      ["Environment paused", health.paused],
      ["Scheduler", health.scheduler],
      ["Task execution enabled", health.task_execution_enabled],
      ["Quality review executor registered", health.quality_review_executor_registered],
      ["Quality review executor enabled", health.quality_review_executor_enabled],
      ["Durable Task Store paused", control.paused],
      ["Terminal failures in last 10 minutes", control.failure_count_last_10m],
      ["Circuit-breaker threshold", control.circuit_breaker_threshold],
      ["Task admissions today (UTC)", admissionText]
    ];
    for (const [label, value] of items) add(runtimeDetails, "li", label + ": " + value);
    runtimeStatus.textContent = "Đã tải trạng thái lúc " + (control.changed_at ? new Date(control.changed_at).toISOString() : "chưa có lần thay đổi") + ".";
  }

  async function refresh() {
    const requestSequence = ++refreshSequence;
    runtimeStatus.textContent = "Đang tải trạng thái…";
    try {
      const [health, operator] = await Promise.all([
        requestJson("/health"),
        requestJson("/api/operator/runtime-control")
      ]);
      if (requestSequence !== refreshSequence) return;
      operatorAuthorized = true;
      renderRuntime(health, operator);
      setControlsEnabled(true);
      actionStatus.textContent = "Đã xác thực quyền operator. Mọi thao tác sẽ được ghi audit.";
    } catch (error) {
      if (requestSequence !== refreshSequence) return;
      operatorAuthorized = false;
      setControlsEnabled(false);
      runtimeDetails.replaceChildren();
      runtimeStatus.textContent = error.status === 403
        ? "Tài khoản đã đăng nhập nhưng không nằm trong danh sách operator được cấp quyền."
        : error.status === 503
          ? "Operator control đang tắt hoặc chưa được cấu hình đầy đủ trong Preview."
          : error.status === 401
            ? "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại."
            : "Không thể tải trạng thái: " + (error.message || "unknown_error");
    }
  }

  async function act(action) {
    if (!operatorAuthorized || actionInProgress) return;
    const reason = reasonInput.value.trim();
    if (reason.length < 12 || reason.length > 240) {
      actionStatus.textContent = "Vui lòng nhập lý do từ 12 đến 240 ký tự.";
      return;
    }
    const verb = action === "pause" ? "tạm dừng nhận và claim task" : "xóa trạng thái pause của Task Store";
    if (!window.confirm("Xác nhận " + verb + "?")) return;
    actionInProgress = true;
    setControlsEnabled(true);
    actionStatus.textContent = "Đang gửi yêu cầu…";
    try {
      const result = await requestJson("/api/operator/runtime-control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason })
      });
      const actionMessage = result.changed
        ? "Đã ghi nhận thao tác. Trạng thái pause hiện tại: " + result.control.paused + "."
        : "Trạng thái không thay đổi.";
      await refresh();
      actionStatus.textContent = actionMessage;
    } catch (error) {
      actionStatus.textContent = "Thao tác bị từ chối: " + (error.message || "unknown_error");
    } finally {
      actionInProgress = false;
      setControlsEnabled(operatorAuthorized);
    }
  }

  async function init() {
    try {
      const result = await requestJson("/auth/google/me");
      status.textContent = "Đã đăng nhập Google: " + result.reviewer.email + ".";
      login.hidden = true;
      logout.hidden = false;
      await refresh();
    } catch (error) {
      status.textContent = error.status === 401
        ? "Chưa đăng nhập. Cần tài khoản Google được cấu hình trong Preview."
        : "Xác thực chưa sẵn sàng: " + (error.message || "unknown_error");
      setControlsEnabled(false);
    }
  }

  byId("refresh-button").addEventListener("click", refresh);
  pauseButton.addEventListener("click", () => act("pause"));
  resumeButton.addEventListener("click", () => act("resume"));
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      const response = await fetch("/auth/google/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("logout_failed");
      window.location.reload();
    } catch {
      status.textContent = "Không thể đăng xuất do yêu cầu chưa được xác nhận. Anh/chị có thể thử lại.";
      logout.disabled = false;
    }
  });
  init();
})();`;
