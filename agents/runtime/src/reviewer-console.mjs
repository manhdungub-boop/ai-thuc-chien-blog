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
    <p>Preview riêng biệt · Biên tập và duyệt bằng chứng có xác thực · Không có quyền xuất bản</p>
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

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(body)
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
      if (!Array.isArray(artifact.research_evidence) || artifact.research_evidence.length === 0) {
        add(detail, "p", "Chưa có trích đoạn nghiên cứu được lưu cùng bản nháp. Không thể lập hồ sơ bằng chứng cho đến khi có nguồn đã truy xuất.");
      } else {
        add(detail, "h3", "Trích đoạn nghiên cứu đã lưu");
        for (const evidence of artifact.research_evidence) {
          add(detail, "p", (evidence.source || "Nguồn") + " · " + (evidence.title || ""));
          add(detail, "blockquote", evidence.excerpt || "");
        }
      }

      const authoringSection = add(detail, "section");
      add(authoringSection, "h3", "Bổ sung bài viết và Claim Manifest");
      add(authoringSection, "p", "Chỉnh sửa JSON của bản nháp. Mỗi luận điểm thực tế phải có claim_id, câu khẳng định chính xác, ít nhất hai URL bằng chứng đã truy xuất và citation_indices đúng thứ tự nguồn. Lưu sẽ tạo phiên bản mới và xóa mọi quyết định duyệt cũ.");
      const editor = add(authoringSection, "textarea");
      editor.rows = 24;
      editor.style.width = "100%";
      editor.style.maxWidth = "100%";
      editor.spellcheck = false;
      editor.value = JSON.stringify(draft, null, 2);
      const saveButton = add(authoringSection, "button", "Lưu bản sửa và tạo hồ sơ bằng chứng");
      saveButton.type = "button";
      saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        try {
          const updatedDraft = JSON.parse(editor.value);
          const result = await postJson("/api/reviewer/drafts/" + encodeURIComponent(artifact.id) + "/authoring", {
            expected_version: artifact.version,
            draft: updatedDraft
          });
          add(authoringSection, "p",
            "Đã lưu phiên bản " + result.artifact.version + ". Hồ sơ bằng chứng: " +
            (result.evidence_ledger.status || "chưa sẵn sàng") +
            ". Quyền xuất bản vẫn bị khóa.");
          await loadQueue();
          await loadDetail(artifact.id);
        } catch (error) {
          add(authoringSection, "p", error.message === "Unexpected end of JSON input"
            ? "JSON chưa hoàn chỉnh. Vui lòng kiểm tra lại nội dung."
            : "Không lưu được: " + (error.message || "unknown_error"));
        } finally {
          saveButton.disabled = false;
        }
      });

      if (evidenceLedger && Array.isArray(evidenceLedger.claims) && evidenceLedger.claims.length > 0 &&
          !artifact.evidence_review?.review_record) {
        const reviewSection = add(detail, "section");
        add(reviewSection, "h3", "Đánh giá từng luận điểm và từng nguồn");
        add(reviewSection, "p", "Chỉ chọn Supported khi mọi nguồn thực sự hỗ trợ đúng luận điểm. Đọc từng trích đoạn; không suy luận từ tiêu đề hoặc tên nhà xuất bản.");
        const decisionForms = [];
        for (const claim of evidenceLedger.claims) {
          const fieldset = add(reviewSection, "fieldset");
          add(fieldset, "legend", claim.claim_id + " · " + claim.claim);
          const sourceForms = [];
          for (const source of claim.sources) {
            add(fieldset, "h4", (source.source || "Nguồn") + " · " + (source.title || ""));
            add(fieldset, "p", source.url);
            add(fieldset, "blockquote", source.excerpt);
            const select = add(fieldset, "select");
            for (const [value, label] of [
              ["supports", "Hỗ trợ luận điểm"],
              ["contradicts", "Mâu thuẫn với luận điểm"],
              ["insufficient", "Chưa đủ bằng chứng"]
            ]) {
              const option = node("option", label);
              option.value = value;
              select.append(option);
            }
            const note = add(fieldset, "textarea");
            note.rows = 2;
            note.style.width = "100%";
            note.placeholder = "Ghi rõ vì sao trích đoạn này hỗ trợ / mâu thuẫn / chưa đủ (ít nhất 20 ký tự)";
            note.required = true;
            note.minLength = 20;
            sourceForms.push({ source_url: source.url, select, note });
          }
          add(fieldset, "h4", "Kết luận cho luận điểm");
          const overall = add(fieldset, "select");
          for (const [value, label] of [
            ["supported", "Supported – tất cả nguồn đều hỗ trợ"],
            ["unsupported", "Unsupported – bằng chứng không hỗ trợ"],
            ["needs_revision", "Needs revision – cần sửa hoặc bổ sung nguồn"]
          ]) {
            const option = node("option", label);
            option.value = value;
            overall.append(option);
          }
          const overallNote = add(fieldset, "textarea");
          overallNote.rows = 2;
          overallNote.style.width = "100%";
          overallNote.placeholder = "Lý do cho kết luận tổng thể (ít nhất 20 ký tự)";
          overallNote.required = true;
          overallNote.minLength = 20;
          decisionForms.push({ claim_id: claim.claim_id, overall, overallNote, sourceForms });
        }
        const submitReview = add(reviewSection, "button", "Gửi đánh giá bằng chứng");
        submitReview.type = "button";
        submitReview.addEventListener("click", async () => {
          submitReview.disabled = true;
          try {
            const decisions = decisionForms.map(item => ({
              claim_id: item.claim_id,
              decision: item.overall.value,
              reviewer_note: item.overallNote.value,
              evidence_reviews: item.sourceForms.map(source => ({
                source_url: source.source_url,
                decision: source.select.value,
                reviewer_note: source.note.value
              }))
            }));
            if (decisions.some(item => item.reviewer_note.trim().length < 20 ||
                item.evidence_reviews.some(review => review.reviewer_note.trim().length < 20))) {
              throw new Error("Mỗi nhận xét phải có ít nhất 20 ký tự.");
            }
            const result = await postJson("/api/reviewer/drafts/" + encodeURIComponent(artifact.id) + "/evidence-review", {
              expected_version: artifact.version,
              decisions
            });
            add(reviewSection, "p", result.owner_release_review_eligible
              ? "Đã ghi nhận. Bài đủ điều kiện chuyển sang bước chủ sở hữu duyệt phát hành; chưa được phép xuất bản."
              : "Đã ghi nhận quyết định. Bài chưa đủ điều kiện duyệt phát hành.");
            await loadQueue();
            await loadDetail(artifact.id);
          } catch (error) {
            add(reviewSection, "p", "Không ghi nhận được: " + (error.message || "unknown_error"));
          } finally {
            submitReview.disabled = false;
          }
        });
      } else if (artifact.evidence_review?.review_record) {
        add(detail, "h3", "Kết quả đánh giá bằng chứng đã lưu");
        add(detail, "pre", JSON.stringify(artifact.evidence_review, null, 2));
        add(detail, "p", "Quyết định đã được gắn với phiên Google đã xác thực. Bước chủ sở hữu duyệt phát hành vẫn riêng biệt; chưa có quyền xuất bản.");
      }
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
    try { await fetch("/auth/google/logout", { method: "POST", credentials: "same-origin", cache: "no-store" }); }
    finally { window.location.reload(); }
  });
  init();
})();`;
