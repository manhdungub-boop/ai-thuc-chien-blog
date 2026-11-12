(() => {
  "use strict";
  const root = document.getElementById("cong-dong");
  if (!root) return;
  const memberPanel = root.querySelector("#community-member-panel");
  const logoutButton = root.querySelector("#community-logout");
  if (!memberPanel || !logoutButton) return;

  if (!document.getElementById("community-account-profile-styles")) {
    const style = document.createElement("style");
    style.id = "community-account-profile-styles";
    style.textContent = `
      .community-account-profile{margin:16px 0;padding:14px;border:1px solid rgba(139,240,206,.22);border-radius:12px;background:rgba(10,16,32,.72)}
      .community-account-profile h4{margin:0 0 12px;color:#e7eaf6;font-size:13px}
      .community-account-profile dl{display:grid;grid-template-columns:minmax(105px, .7fr) minmax(0,1.3fr);gap:9px 12px;margin:0}
      .community-account-profile dt{color:#9ba7c2;font-size:11px}
      .community-account-profile dd{margin:0;color:#e7eaf6;font-size:11px;overflow-wrap:anywhere}
      .community-account-profile .account-profile-note{margin:12px 0 0;color:#8c96af;font-size:10px;line-height:1.6}
      .community-account-profile .account-profile-error{color:#ffb5b5}
      @media(max-width:420px){.community-account-profile dl{grid-template-columns:1fr;gap:4px}.community-account-profile dd{margin-bottom:7px}}
    `;
    document.head.appendChild(style);
  }

  const panel = document.createElement("section");
  panel.className = "community-account-profile";
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  const heading = document.createElement("h4");
  heading.textContent = "Hồ sơ tài khoản";
  const details = document.createElement("dl");
  const note = document.createElement("p");
  note.className = "account-profile-note";
  note.textContent = "Các phương thức mạng xã hội bên dưới được liên kết với cùng một ID thành viên. Thông tin bí mật và mật khẩu không được hiển thị.";
  panel.append(heading, details, note);
  memberPanel.insertBefore(panel, logoutButton);

  let loading = false;
  const formatDate = (value) => {
    if (!value) return "Không có dữ liệu";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Không có dữ liệu" :
      new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
  };
  const addRow = (label, value) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value || "Chưa có dữ liệu";
    details.append(term, description);
  };
  const render = (account) => {
    details.replaceChildren();
    addRow("ID tài khoản", account.id);
    addRow("Tên thành viên", account.displayName || account.username);
    addRow("Tên đăng nhập", account.username ? "@" + account.username : "");
    addRow("Email", account.email || "Chưa có email tài khoản");
    addRow("Xác minh email", account.email ? (account.emailVerified ? "Đã xác minh" : "Chưa xác minh") : "Không áp dụng");
    addRow("Ngày tạo", formatDate(account.createdAt));
    const providerNames = { google: "Google", facebook: "Facebook" };
    const providers = Array.isArray(account.linkedProviders) ?
      account.linkedProviders.map(provider => providerNames[provider] || provider).join(", ") : "";
    addRow("Mạng xã hội liên kết", providers || "Chưa liên kết");
    panel.hidden = false;
  };

  async function loadProfile() {
    if (memberPanel.hidden || loading) return;
    loading = true;
    try {
      const response = await fetch("/api/community/account", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Accept": "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.account) throw new Error("Không thể tải thông tin tài khoản.");
      if (memberPanel.hidden) return;
      render(payload.account);
    } catch (_error) {
      if (!memberPanel.hidden) {
        details.replaceChildren();
        const error = document.createElement("dd");
        error.className = "account-profile-error";
        error.textContent = "Chưa tải được hồ sơ. Hãy tải lại trang để thử lại.";
        details.appendChild(error);
        panel.hidden = false;
      }
    } finally {
      loading = false;
    }
  }

  const observer = new MutationObserver(() => {
    if (memberPanel.hidden) {
      panel.hidden = true;
      details.replaceChildren();
    } else {
      loadProfile();
    }
  });
  observer.observe(memberPanel, { attributes: true, attributeFilter: ["hidden"] });
  if (!memberPanel.hidden) loadProfile();
})();
