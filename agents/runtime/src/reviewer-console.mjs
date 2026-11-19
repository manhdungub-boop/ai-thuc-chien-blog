export const REVIEWER_CONSOLE_HTML = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Bảng điều khiển duyệt bài | DUNG - AI</title>
</head>
<body>
  <main>
    <h1>Bảng điều khiển duyệt bài</h1>
    <p>Preview riêng biệt · Chỉ đọc · Không có quyền xuất bản</p>
    <p id="session-status" role="status">Đang kiểm tra phiên đăng nhập…</p>
    <p>
      <a id="login-link" href="/auth/google/start">Đăng nhập Google</a>
      <button id="logout-button" type="button" hidden>Đăng xuất</button>
      <button id="refresh-button" type="button">Làm mới hàng chờ</button>
    </p>
    <h2>Bài viết chờ duyệt</h2>
    <p id="queue-status" role="status">Chưa tải hàng chờ.</p>
    <ul id="review-queue"></ul>
    <h2>Đề cương cần tác giả bổ sung</h2>
    <p id="authoring-queue-status" role="status">Chưa tải danh sách đề cương.</p>
    <ul id="authoring-queue"></ul>
    <section id="draft-detail" aria-live="polite">
      <h2>Chi tiết bài viết</h2>
      <p>Chọn một bài trong hàng chờ để xem nội dung và bằng chứng.</p>
    </section>
  </main>
  <script src="/reviewer-console.js" defer></script>
</body>
</html>`;

export const REVIEWER_CONSOLE_JS = `"use strict";
(() => {
  const byId = (id) => document.getElementById(id);
  const status = byId("session-status");
  const queueStatus = byId("queue-status");
  const queue = byId("review-queue");
  const authoringQueue = byId("authoring-queue");
  const authoringQueueStatus = byId("authoring-queue-status");
  const detail = byId("draft-detail");
  const login = byId("login-link");
  const logout = byId("logout-button");

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

  async function getJson(path) {
    const response = await fetch(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "accept": "application/json" }
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

  function showError(target, error) {
    target.textContent = error.status === 401
      ? "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại."
      : "Không thể tải dữ liệu: " + (error.message || "unknown_error");
  }

  function renderQueue(items) {
    queue.replaceChildren();
    if (!items.length) {
      add(queue, "li", "Hiện chưa có bài viết chờ duyệt.");
      return;
    }
    for (const item of items) {
      const li = node("li");
      const button = node("button", item.title + " · " + item.status + " · " + item.word_count + " từ · Bằng chứng: " + (item.release_review_status || "chưa rà soát"));
      button.type = "button";
      button.addEventListener("click", () => loadDetail(item.id));
      li.append(button);
      add(li, "p", "Phiên bản " + item.version + " · " + item.issue_count + " cảnh báo chất lượng");
      queue.append(li);
    }
  }

  function renderAuthoringQueue(items) {
    authoringQueue.replaceChildren();
    if (!items.length) {
      add(authoringQueue, "li", "Hiện chưa có đề cương cần tác giả bổ sung.");
      return;
    }
    for (const item of items) {
      const li = node("li");
      const button = node("button", item.title + " · " + item.word_count + " từ · " + item.issue_count + " vấn đề cần bổ sung");
      button.type = "button";
      button.addEventListener("click", () => loadDetail(item.id));
      li.append(button);
      add(li, "p", "Phiên bản " + item.version + " · Trạng thái: cần tác giả hoàn thiện; chưa đủ điều kiện duyệt bằng chứng.");
      authoringQueue.append(li);
    }
  }

  async function loadQueue() {
    queueStatus.textContent = "Đang tải hàng chờ…";
    authoringQueueStatus.textContent = "Đang tải đề cương…";
    try {
      const [reviewResult, authoringResult] = await Promise.all([
        getJson("/api/reviewer/drafts?limit=20"),
        getJson("/api/reviewer/drafts-needing-authoring?limit=20")
      ]);
      renderQueue(reviewResult.items || []);
      renderAuthoringQueue(authoringResult.items || []);
      queueStatus.textContent = "Đã tải " + (reviewResult.count || 0) + " bài chờ duyệt. Chế độ chỉ đọc.";
      authoringQueueStatus.textContent = "Đã tải " + (authoringResult.count || 0) + " đề cương cần bổ sung. Không được chuyển thẳng sang xuất bản.";
    } catch (error) {
      showError(queueStatus, error);
      showError(authoringQueueStatus, error);
    }
  }

  function renderSourceList(sources) {
    const list = add(detail, "ul");
    for (const source of (Array.isArray(sources) ? sources : [])) {
      const item = node("li");
      add(item, "p", (source.publisher || "Nguồn") + ": " + (source.title || "Không có tiêu đề"));
      try {
        const url = new URL(source.url);
        if (url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443")) {
          const link = node("a", url.href);
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.referrerPolicy = "no-referrer";
          item.append(link);
        } else {
          add(item, "p", "Đường dẫn không được phép hiển thị.");
        }
      } catch {
        add(item, "p", "Đường dẫn nguồn không hợp lệ.");
      }
      list.append(item);
    }
  }

  async function loadDetail(id) {
    detail.replaceChildren();
    add(detail, "h2", "Đang tải chi tiết bài viết…");
    try {
      const result = await getJson("/api/reviewer/drafts/" + encodeURIComponent(id));
      const artifact = result.artifact;
      const draft = artifact.draft || {};
      detail.replaceChildren();
      add(detail, "h2", draft.title || "Bài viết");
      add(detail, "p", "Mã: " + artifact.id + " · Phiên bản: " + artifact.version + " · Trạng thái: " + artifact.status);
      add(detail, "p", "Tác giả: " + (draft.author || "Chưa xác định"));
      add(detail, "h3", "Nội dung Markdown (hiển thị dạng văn bản an toàn)");
      add(detail, "pre", draft.body_markdown || "Chưa có nội dung");
      add(detail, "h3", "Nguồn tham khảo");
      renderSourceList(draft.sources);
      add(detail, "h3", "Kết quả kiểm tra cấu trúc");
      add(detail, "pre", JSON.stringify(artifact.quality_review || {}, null, 2));
      add(detail, "h3", "Hồ sơ bằng chứng");
      const evidenceLedger = artifact.evidence_review?.ledger;
      if (!evidenceLedger || !Array.isArray(evidenceLedger.claims) || evidenceLedger.claims.length === 0) {
        add(detail, "p", "CHƯA ĐỦ ĐIỀU KIỆN ĐÁNH GIÁ: bản nháp chưa có evidence ledger kèm trích đoạn nguồn đã thu thập. Danh sách URL hoặc claim manifest không thay thế được bằng chứng gốc. Chưa thể ghi nhận quyết định supported / unsupported / needs_revision.");
        if (Array.isArray(draft.claims) && draft.claims.length > 0) {
          add(detail, "p", "Bản nháp khai báo " + draft.claims.length + " tuyên bố và liên kết nguồn, nhưng chưa có trích đoạn để người duyệt đối chiếu.");
        }
      } else {
        add(detail, "p", "Đã có " + evidenceLedger.claims.length + " tuyên bố trong hồ sơ bằng chứng đã lưu.");
        add(detail, "pre", JSON.stringify(artifact.evidence_review, null, 2));
      }
      add(detail, "p", "Đây là màn hình chỉ đọc. Chưa có thao tác đánh giá hoặc gửi quyết định; duyệt phát hành và xuất bản vẫn là các cổng riêng.");
    } catch (error) {
      detail.replaceChildren();
      add(detail, "h2", "Không thể mở bài viết");
      add(detail, "p", error.status === 401 ? "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại." : (error.message || "request_failed"));
    }
  }

  async function init() {
    try {
      const result = await getJson("/auth/google/me");
      status.textContent = "Đã đăng nhập: " + result.reviewer.email + " · Phiên có thời hạn.";
      login.hidden = true;
      logout.hidden = false;
      await loadQueue();
    } catch (error) {
      status.textContent = error.status === 401
        ? "Chưa đăng nhập. Đăng nhập bằng tài khoản Google được cho phép để xem hàng chờ."
        : "Xác thực chưa sẵn sàng: " + (error.message || "unknown_error");
      queueStatus.textContent = "Hàng chờ đang khóa cho đến khi xác thực Preview được cấu hình.";
      login.hidden = false;
    }
  }

  byId("refresh-button").addEventListener("click", loadQueue);
  logout.addEventListener("click", async () => {
    try { await fetch("/auth/google/logout", { credentials: "same-origin", cache: "no-store" }); }
    finally { window.location.reload(); }
  });
  init();
})();`;
