const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.site-header nav');

if (menuButton && nav) {
  menuButton.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
    menuButton.textContent = open ? '×' : '☰';
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Mở menu');
      menuButton.textContent = '☰';
    });
  });
}

const year = document.querySelector('#year');
if (year) year.textContent = String(new Date().getFullYear());

// Accessible copy buttons for reusable prompt templates and other text blocks.
const copyButtons = document.querySelectorAll('[data-copy-target]');
copyButtons.forEach((button) => {
  const targetId = button.getAttribute('data-copy-target');
  const statusId = button.getAttribute('data-copy-status');
  const target = targetId ? document.getElementById(targetId) : null;
  const status = statusId ? document.getElementById(statusId) : null;
  if (!target) {
    button.disabled = true;
    if (status) status.textContent = 'Không tìm thấy nội dung cần sao chép.';
    return;
  }
  button.addEventListener('click', async () => {
    const text = 'value' in target ? target.value : (target.textContent || '');
    if (!text.trim()) {
      if (status) status.textContent = 'Không có nội dung để sao chép.';
      return;
    }
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      if (status) status.textContent = 'Đã sao chép. Bạn có thể dán vào công cụ AI.';
    } catch (_error) {
      if (status) status.textContent = 'Không thể sao chép tự động. Hãy chọn nội dung rồi sao chép thủ công.';
    }
  });
});

// Client-side article search and topic filters. Topic cards used to point to the same
// unfiltered list; this keeps search and topic selection working together.
const articleSearch = document.querySelector('#article-search');
const articleSearchStatus = document.querySelector('#article-search-status');
const articleGrid = document.querySelector('#article-grid');
const searchableArticles = Array.from(document.querySelectorAll('#article-grid .article-card'));
const articleTools = document.querySelector('.article-tools');
const topicCards = Array.from(document.querySelectorAll('.topic-card[data-topic]'));
const topicLabels = {
  tools: 'Công cụ AI',
  automation: 'Tự động hóa',
  content: 'AI sáng tạo',
  earning: 'AI kiếm tiền'
};
const topicKeywords = {
  tools: ['công cụ', 'api key', 'rag', 'kiểm thử chất lượng ai', 'json schema', 'bản đồ công cụ'],
  automation: ['workflow', 'tự động hóa', 'activepieces', 'retry', 'chống trùng', 'schema'],
  content: ['prompt', 'kiểm chứng nội dung', 'bắt đầu với ai', 'seo kỹ thuật', 'search console', 'prompt injection'],
  // These are practical building blocks for an AI-powered online business, not promises of income.
  earning: ['đo hiệu quả blog', 'bản đồ công cụ', 'đo hiệu quả workflow', 'workflow ai có kiểm duyệt', 'seo kỹ thuật', 'activepieces']
};
let selectedTopic = '';

const normalizeSearchText = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .trim();

const filterArticles = () => {
  const query = normalizeSearchText(articleSearch ? articleSearch.value : '');
  const keywords = (topicKeywords[selectedTopic] || []).map(normalizeSearchText);
  let visibleCount = 0;

  searchableArticles.forEach((article) => {
    const searchableText = normalizeSearchText(article.textContent || '');
    const matchesQuery = !query || searchableText.includes(query);
    const matchesTopic = !selectedTopic || keywords.some((keyword) => searchableText.includes(keyword));
    article.hidden = !(matchesQuery && matchesTopic);
    if (!article.hidden) visibleCount += 1;
  });

  if (!articleSearchStatus) return;
  const topicPrefix = selectedTopic ? `Chủ đề: ${topicLabels[selectedTopic]}. ` : '';
  if (!query && !selectedTopic) {
    articleSearchStatus.textContent = `Hiển thị tất cả ${searchableArticles.length} bài viết.`;
  } else if (visibleCount) {
    const earningNote = selectedTopic === 'earning' ? ' Đây là các bài nền tảng vận hành, không phải cam kết thu nhập.' : '';
    articleSearchStatus.textContent = `${topicPrefix}Hiển thị ${visibleCount}/${searchableArticles.length} bài viết phù hợp${query ? ' với từ khóa tìm kiếm' : ''}.${earningNote}`;
  } else if (selectedTopic === 'earning' && !query) {
    articleSearchStatus.textContent = 'Chưa có bài chuyên biệt về tạo doanh thu bằng AI. Các bài đang hiển thị sẽ được bổ sung khi có nội dung phù hợp; hãy chọn chủ đề khác để tiếp tục đọc.';
  } else {
    articleSearchStatus.textContent = 'Không tìm thấy bài viết phù hợp. Thử từ khóa khác hoặc chọn lại chủ đề đang mở.';
  }
};

if (searchableArticles.length) {
  if (articleSearch) articleSearch.addEventListener('input', filterArticles);
  if (articleTools) articleTools.hidden = false;
  topicCards.forEach((card) => {
    card.addEventListener('click', () => {
      const topic = card.getAttribute('data-topic') || '';
      selectedTopic = selectedTopic === topic ? '' : topic;
      topicCards.forEach((item) => {
        if (item === card && selectedTopic) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      });
      if (articleSearch) articleSearch.value = '';
      filterArticles();
    });
  });
  filterArticles();
}

const revealItems = document.querySelectorAll('.topic-card, .article-card, .intro-grid');
const reduceMotion = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if ('IntersectionObserver' in window && !reduceMotion && revealItems.length) {
  const revealStyle = document.createElement('style');
  revealStyle.textContent = [
    '.reveal-ready{opacity:0;transform:translateY(14px);transition:opacity .6s ease,transform .6s ease}',
    '.reveal-ready.visible{opacity:1;transform:translateY(0)}',
    '@media(prefers-reduced-motion:reduce){.reveal-ready{opacity:1;transform:none;transition:none}}'
  ].join('');
  document.head.appendChild(revealStyle);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealItems.forEach((element) => {
    element.classList.add('reveal-ready');
    observer.observe(element);
  });
} else {
  // Keep content visible when reveal animations are unavailable or not wanted.
  revealItems.forEach((element) => element.classList.add('visible'));
}


// Member registration and persistent topic discussion rooms.
(() => {
  if (!document.body || typeof document.createElement !== 'function') return;
  const root = document.getElementById('cong-dong');
  if (!root) return;
  const primaryHost = 'ai-thuc-chien-blog.manhdungub.workers.dev';
  const previewHost = 'ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev';
  const pendingResetToken = new URLSearchParams(window.location.search).get('reset') || '';
  const pendingVerifyToken = new URLSearchParams(window.location.search).get('verify') || '';
  const authPanel = root.querySelector('#community-auth-panel');
  const memberPanel = root.querySelector('#community-member-panel');
  const authForm = root.querySelector('#community-auth-form');
  const authTitle = root.querySelector('#community-auth-title');
  const authDescription = root.querySelector('#community-auth-description');
  const authSubmit = root.querySelector('#community-auth-submit');
  const authStatus = root.querySelector('#community-auth-status');
  const switchCopy = root.querySelector('#community-switch-copy');
  const switchModeButton = root.querySelector('#community-switch-mode');
  const usernameWrap = root.querySelector('#community-username-wrap');
  const usernameInput = root.querySelector('#community-username');
  const displayWrap = root.querySelector('#community-display-wrap');
  const displayInput = root.querySelector('#community-display-name');
  const emailInput = root.querySelector('#community-email');
  const passwordInput = root.querySelector('#community-password');
  const forgotWrap = root.querySelector('#community-forgot-wrap');
  const forgotButton = root.querySelector('#community-forgot-password');
  const resetForm = root.querySelector('#community-reset-form');
  const resetPasswordInput = root.querySelector('#community-reset-password');
  const resetStatus = root.querySelector('#community-reset-status');
  const resetCancelButton = root.querySelector('#community-reset-cancel');
  const memberName = root.querySelector('#community-member-name');
  const memberStatus = root.querySelector('#community-member-status');
  const logoutButton = root.querySelector('#community-logout');
  const roomTitle = root.querySelector('#community-room-title');
  const roomDescription = root.querySelector('#community-room-description');
  const roomTabs = Array.from(root.querySelectorAll('[data-community-topic]'));
  const loginPrompt = root.querySelector('#community-login-prompt');
  const messageList = root.querySelector('#community-messages');
  const roomStatus = root.querySelector('#community-room-status');
  const chatForm = root.querySelector('#community-chat-form');
  const messageInput = root.querySelector('#community-message-input');
  const sendButton = root.querySelector('#community-send');
  const roomInfo = {
    tools: { title: 'Công cụ AI', description: 'Hỏi đáp và chia sẻ cách chọn, sử dụng công cụ AI.' },
    automation: { title: 'Tự động hóa', description: 'Trao đổi workflow, tích hợp ứng dụng và xử lý lỗi.' },
    content: { title: 'AI sáng tạo', description: 'Chia sẻ prompt, quy trình viết và kiểm chứng nội dung.' },
    earning: { title: 'AI kiếm tiền', description: 'Thảo luận thử nghiệm mô hình, đo nhu cầu và hiệu quả thực tế.' }
  };
  let authMode = 'register';
  let currentMember = null;
  let currentTopic = 'tools';
  let sending = false;
  let loading = false;

  const setStatus = (node, text, kind = '') => {
    if (!node) return;
    node.textContent = text || '';
    node.dataset.kind = kind;
  };
  const api = async (path, options = {}) => {
    const response = await fetch(`/api/community${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    let payload = {};
    try { payload = await response.json(); } catch (_error) { /* Keep a safe fallback for non-JSON responses. */ }
    if (!response.ok) {
      const error = new Error(payload.error || `Yêu cầu thất bại (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  };
  const setAuthMode = (mode) => {
    authMode = mode;
    const registering = mode === 'register';
    const requestingReset = mode === 'reset-request';
    authTitle.textContent = registering ? 'Tham gia cộng đồng' : requestingReset ? 'Đặt lại mật khẩu' : 'Chào mừng trở lại';
    authDescription.textContent = registering
      ? 'Đăng ký miễn phí để tham gia các phòng thảo luận theo chủ đề.'
      : requestingReset
        ? 'Nhập email đã đăng ký. Nếu tài khoản hợp lệ, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.'
        : 'Đăng nhập để tiếp tục các cuộc thảo luận của bạn.';
    usernameWrap.hidden = !registering;
    usernameInput.hidden = !registering;
    usernameInput.required = registering;
    displayWrap.hidden = !registering;
    displayInput.hidden = !registering;
    displayInput.required = false;
    passwordInput.hidden = requestingReset;
    passwordInput.required = !requestingReset;
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    passwordInput.minLength = registering ? 10 : 1;
    authSubmit.innerHTML = registering ? 'Đăng ký thành viên <span>→</span>' : requestingReset ? 'Gửi liên kết đặt lại mật khẩu <span>→</span>' : 'Đăng nhập <span>→</span>';
    switchCopy.textContent = registering ? 'Đã có tài khoản?' : 'Bạn đã nhớ mật khẩu?';
    switchModeButton.textContent = registering ? 'Đăng nhập' : 'Quay lại';
    forgotWrap.hidden = mode !== 'login';
    setStatus(authStatus, '');
  };
  const showMember = (member) => {
    currentMember = member || null;
    authPanel.hidden = Boolean(currentMember);
    memberPanel.hidden = !currentMember;
    loginPrompt.hidden = Boolean(currentMember);
    chatForm.hidden = !currentMember;
    if (currentMember) {
      memberName.textContent = `${currentMember.displayName || currentMember.username} (@${currentMember.username})`;
      setStatus(authStatus, '');
      setStatus(memberStatus, '');
    }
  };
  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const renderMessages = (messages) => {
    messageList.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'community-empty';
      empty.textContent = 'Chưa có tin nhắn trong phòng này. Hãy là người mở đầu cuộc trò chuyện nhé!';
      messageList.appendChild(empty);
      return;
    }
    messages.forEach((message) => {
      const item = document.createElement('article');
      item.className = `community-message${message.own ? ' own' : ''}`;
      const meta = document.createElement('div');
      meta.className = 'community-message-meta';
      const author = document.createElement('strong');
      author.textContent = message.displayName || message.username || 'Thành viên';
      const time = document.createElement('time');
      time.textContent = formatDate(message.createdAt);
      if (message.createdAt) time.dateTime = message.createdAt;
      meta.append(author, time);
      const body = document.createElement('p');
      body.textContent = message.body;
      item.append(meta, body);
      if (message.own) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'community-delete-message';
        remove.textContent = 'Xóa tin nhắn của tôi';
        remove.addEventListener('click', async () => {
          if (!window.confirm('Bạn muốn xóa tin nhắn này?')) return;
          remove.disabled = true;
          try {
            await api(`/messages/${encodeURIComponent(message.id)}`, { method: 'DELETE' });
            await loadMessages();
          } catch (error) {
            setStatus(roomStatus, error.message, 'error');
            remove.disabled = false;
          }
        });
        item.appendChild(remove);
      }
      messageList.appendChild(item);
    });
    messageList.scrollTop = messageList.scrollHeight;
  };
  async function loadMessages() {
    if (!currentMember || loading) return;
    loading = true;
    try {
      const payload = await api(`/messages?topic=${encodeURIComponent(currentTopic)}`, { method: 'GET', headers: {} });
      renderMessages(payload.messages || []);
      setStatus(roomStatus, 'Đã cập nhật tin nhắn. Phòng tự làm mới khoảng 15 giây khi bạn đang xem.', 'success');
    } catch (error) {
      if (error.status === 401) {
        showMember(null);
        setStatus(roomStatus, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'error');
      } else {
        setStatus(roomStatus, error.message, 'error');
      }
    } finally {
      loading = false;
    }
  }
  const selectTopic = (topic) => {
    if (!roomInfo[topic]) return;
    currentTopic = topic;
    roomTabs.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.communityTopic === topic)));
    roomTitle.textContent = roomInfo[topic].title;
    roomDescription.textContent = roomInfo[topic].description;
    setStatus(roomStatus, '');
    if (currentMember) loadMessages();
    else {
      messageList.replaceChildren();
      const prompt = document.createElement('p');
      prompt.className = 'community-empty';
      prompt.textContent = 'Đăng nhập để xem và tham gia cuộc thảo luận trong phòng này.';
      messageList.appendChild(prompt);
    }
  };

  const isPreviewPasswordReset = window.location.hostname === previewHost && Boolean(pendingResetToken);
  const isPreviewEmailVerification = window.location.hostname === previewHost && Boolean(pendingVerifyToken);
  if (window.location.hostname !== primaryHost && !isPreviewPasswordReset && !isPreviewEmailVerification) {
    authPanel.hidden = true;
    memberPanel.hidden = true;
    loginPrompt.hidden = true;
    chatForm.hidden = true;
    const link = document.createElement('a');
    link.href = `https://${primaryHost}/#cong-dong`;
    link.textContent = 'Mở cộng đồng trên website chính';
    link.className = 'community-primary-link';
    messageList.replaceChildren();
    const note = document.createElement('p');
    note.className = 'community-empty';
    note.textContent = 'Để bảo vệ phiên đăng nhập, hãy sử dụng tên miền chính của blog.';
    messageList.append(note, link);
    return;
  }

  switchModeButton.addEventListener('click', () => setAuthMode(authMode === 'register' ? 'login' : 'register'));
  forgotButton.addEventListener('click', () => setAuthMode('reset-request'));
  resetCancelButton.addEventListener('click', () => {
    window.history.replaceState(null, '', window.location.pathname + '#cong-dong');
    resetForm.hidden = true;
    authForm.hidden = false;
    setAuthMode('login');
    setStatus(resetStatus, '');
  });
  resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = new URLSearchParams(window.location.search).get('reset') || '';
    const password = resetPasswordInput.value;
    const submit = resetForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus(resetStatus, 'Đang cập nhật mật khẩu…');
    try {
      await api('/password-reset/complete', { method: 'POST', body: JSON.stringify({ token, password }) });
      resetPasswordInput.value = '';
      window.history.replaceState(null, '', window.location.pathname + '#cong-dong');
      resetForm.hidden = true;
      authForm.hidden = false;
      setAuthMode('login');
      setStatus(authStatus, 'Mật khẩu đã được đặt lại. Vui lòng đăng nhập bằng mật khẩu mới.', 'success');
    } catch (error) {
      setStatus(resetStatus, error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    authSubmit.disabled = true;
    const payload = { email: emailInput.value.trim(), password: passwordInput.value };
    if (authMode === 'register') {
      setStatus(authStatus, 'Đang tạo tài khoản an toàn…');
      payload.username = usernameInput.value.trim().toLowerCase();
      payload.displayName = displayInput.value.trim() || payload.username;
    } else if (authMode === 'reset-request') {
      setStatus(authStatus, 'Đang gửi yêu cầu đặt lại mật khẩu…');
      delete payload.password;
    } else {
      setStatus(authStatus, 'Đang đăng nhập…');
    }
    try {
      if (authMode === 'reset-request') {
        const result = await api('/password-reset/request', { method: 'POST', body: JSON.stringify({ email: payload.email }) });
        setStatus(authStatus, result.message || 'Nếu email này có tài khoản hợp lệ, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.', 'success');
        passwordInput.value = '';
      } else if (authMode === 'register') {
        const result = await api('/register', { method: 'POST', body: JSON.stringify(payload) });
        passwordInput.value = '';
        setStatus(authStatus, result.message || 'Đăng ký đã được tiếp nhận. Vui lòng mở email và xác nhận địa chỉ trước khi đăng nhập.', 'success');
      } else {
        const result = await api('/login', { method: 'POST', body: JSON.stringify(payload) });
        showMember(result.member);
        passwordInput.value = '';
        setStatus(roomStatus, 'Đăng nhập thành công. Đang tải phòng thảo luận…', 'success');
        await loadMessages();
      }
    } catch (error) {
      setStatus(authStatus, error.message, 'error');
    } finally {
      authSubmit.disabled = false;
    }
  });
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try {
      await api('/logout', { method: 'POST', body: '{}' });
      showMember(null);
      messageList.replaceChildren();
      const prompt = document.createElement('p');
      prompt.className = 'community-empty';
      prompt.textContent = 'Bạn đã đăng xuất. Đăng nhập để tiếp tục thảo luận.';
      messageList.appendChild(prompt);
      setStatus(roomStatus, 'Bạn đã đăng xuất.', 'success');
    } catch (error) {
      setStatus(memberStatus, error.message, 'error');
    } finally {
      logoutButton.disabled = false;
    }
  });
  roomTabs.forEach((button) => button.addEventListener('click', () => selectTopic(button.dataset.communityTopic)));
  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = messageInput.value.trim();
    if (!body || sending || !currentMember) return;
    sending = true;
    sendButton.disabled = true;
    setStatus(roomStatus, 'Đang gửi tin nhắn…');
    try {
      await api('/messages', { method: 'POST', body: JSON.stringify({ topic: currentTopic, body }) });
      messageInput.value = '';
      await loadMessages();
      messageInput.focus();
    } catch (error) {
      setStatus(roomStatus, error.message, 'error');
    } finally {
      sending = false;
      sendButton.disabled = false;
    }
  });

  if (pendingVerifyToken) {
    authTitle.textContent = 'Xác nhận email';
    authDescription.textContent = 'Đang xác nhận địa chỉ email của bạn…';
    authForm.hidden = true;
    resetForm.hidden = true;
    forgotWrap.hidden = true;
    setStatus(authStatus, 'Đang xác nhận email…');
    api('/verify-email', { method: 'POST', body: JSON.stringify({ token: pendingVerifyToken }) }).then(() => {
      window.history.replaceState(null, '', window.location.pathname + '#cong-dong');
      authForm.hidden = false;
      setAuthMode('login');
      setStatus(authStatus, 'Email đã được xác nhận. Bạn có thể đăng nhập.', 'success');
    }).catch((error) => {
      authForm.hidden = false;
      setAuthMode('login');
      setStatus(authStatus, error.message, 'error');
    });
  } else if (pendingResetToken) {
    authTitle.textContent = 'Đặt lại mật khẩu';
    authDescription.textContent = 'Tạo mật khẩu mới để tiếp tục sử dụng tài khoản.';
    authForm.hidden = true;
    resetForm.hidden = false;
    forgotWrap.hidden = true;
    resetPasswordInput.focus();
  } else {
    setAuthMode('register');
  }
  selectTopic('tools');
  if (!pendingResetToken && !pendingVerifyToken) api('/me', { method: 'GET', headers: {} }).then((result) => {
    showMember(result.member);
    if (result.member) loadMessages();
  }).catch((error) => {
    setStatus(authStatus, error.status === 503 ? 'Cộng đồng đang chờ cấu hình cơ sở dữ liệu. Tài khoản và tin nhắn chưa thể lưu cho đến khi quản trị viên hoàn tất thiết lập.' : error.message, 'error');
    authSubmit.disabled = error.status === 503;
    switchModeButton.disabled = error.status === 503;
    roomTabs.forEach((button) => { button.disabled = error.status === 503; });
  });
  window.setInterval(() => {
    if (currentMember && document.visibilityState === 'visible') loadMessages();
  }, 15000);
})();

// Site-wide AI reader assistant. Conversation stays in this tab and is not persisted.
(() => {
  // Keep non-browser test harnesses and partial DOM environments unaffected.
  if (!document.body || typeof document.createElement !== 'function' || typeof document.getElementById !== 'function') return;
  if (document.getElementById('reader-ai-chat')) return;
  const apiUrl = 'https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat';
  const root = document.createElement('div');
  root.id = 'reader-ai-chat';
  root.innerHTML = `
    <button class="reader-chat-launcher" type="button" aria-expanded="false" aria-controls="reader-chat-panel"><span aria-hidden="true">✦</span><span class="reader-chat-launcher-label">Hỏi AI</span></button>
    <section class="reader-chat-panel" id="reader-chat-panel" role="dialog" aria-modal="false" aria-labelledby="reader-chat-title" hidden>
      <header class="reader-chat-header"><div class="reader-chat-brand"><span class="reader-chat-avatar" aria-hidden="true">AI</span><div><h2 id="reader-chat-title">Trợ lý AI Thực Chiến</h2><p><span class="reader-chat-status-dot"></span> Hỏi về AI và bài viết trên blog</p></div></div><button class="reader-chat-close" type="button" aria-label="Đóng khung chat">×</button></header>
      <div class="reader-chat-messages" role="log" aria-live="polite" aria-relevant="additions text"><div class="reader-chat-message assistant"><p>Xin chào! 👋 Bạn đang cần giải đáp điều gì về AI, công cụ hoặc tự động hóa?</p></div><div class="reader-chat-quick"><button type="button" data-chat-prompt="Tôi mới bắt đầu dùng AI, nên bắt đầu từ đâu?">Tôi mới dùng AI</button><button type="button" data-chat-prompt="Làm sao kiểm chứng câu trả lời của AI?">Kiểm chứng AI</button><button type="button" data-chat-prompt="Gợi ý một workflow AI miễn phí cho công việc của tôi.">Workflow miễn phí</button></div></div>
      <p class="reader-chat-error" role="status" hidden></p>
      <form class="reader-chat-form"><label class="reader-chat-sr-only" for="reader-chat-input">Nhập câu hỏi</label><textarea id="reader-chat-input" rows="1" maxlength="1200" placeholder="Nhập câu hỏi của bạn…" required></textarea><button class="reader-chat-send" type="submit" aria-label="Gửi câu hỏi">➤</button></form>
      <p class="reader-chat-disclaimer">AI có thể mắc lỗi. Đừng gửi mật khẩu, mã OTP hoặc API key.</p>
    </section>`;
  document.body.appendChild(root);
  const launcher = root.querySelector('.reader-chat-launcher');
  const panel = root.querySelector('.reader-chat-panel');
  const close = root.querySelector('.reader-chat-close');
  const log = root.querySelector('.reader-chat-messages');
  const form = root.querySelector('.reader-chat-form');
  const input = root.querySelector('#reader-chat-input');
  const send = root.querySelector('.reader-chat-send');
  const error = root.querySelector('.reader-chat-error');
  const messages = [];
  let busy = false;

  const setOpen = (open) => {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.querySelector('.reader-chat-launcher-label').textContent = open ? 'Đóng chat' : 'Hỏi AI';
    if (open) input.focus();
  };
  launcher.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => { setOpen(false); launcher.focus(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) setOpen(false); });

  const addMessage = (role, text, extraClass = '') => {
    const item = document.createElement('div');
    item.className = `reader-chat-message ${role} ${extraClass}`.trim();
    const paragraph = document.createElement('p');
    if (role === 'assistant') {
      // Render only verified internal article links; all other text remains plain text.
      const linkPattern = /\[([^\]\n]{1,180})\]\((https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev\/articles\/[a-z0-9-]+)\)/g;
      let cursor = 0;
      let match;
      while ((match = linkPattern.exec(text)) !== null) {
        paragraph.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        const link = document.createElement('a');
        link.textContent = match[1];
        link.href = match[2];
        link.rel = 'noopener noreferrer';
        paragraph.appendChild(link);
        cursor = linkPattern.lastIndex;
      }
      paragraph.appendChild(document.createTextNode(text.slice(cursor)));
    } else {
      paragraph.textContent = text;
    }
    item.appendChild(paragraph);
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  };
  const ask = async (rawText) => {
    const text = String(rawText || '').trim();
    if (!text || busy) return;
    const quick = log.querySelector('.reader-chat-quick');
    if (quick) quick.remove();
    error.hidden = true;
    error.textContent = '';
    addMessage('user', text);
    messages.push({ role: 'user', content: text.slice(0, 1200) });
    input.value = '';
    busy = true;
    send.disabled = true;
    input.disabled = true;
    const loading = addMessage('assistant', 'Đang tìm câu trả lời…', 'is-loading');
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.slice(-8),
          page: { title: document.title, path: location.pathname },
        }),
      });
      const data = await response.json().catch(() => ({}));
      loading.remove();
      if (!response.ok || typeof data.answer !== 'string' || !data.answer.trim()) {
        throw new Error(data.error || 'Chưa thể trả lời lúc này. Vui lòng thử lại sau.');
      }
      const answer = data.answer.trim().slice(0, 6000);
      addMessage('assistant', answer);
      messages.push({ role: 'assistant', content: answer });
      if (messages.length > 8) messages.splice(0, messages.length - 8);
    } catch (err) {
      loading.remove();
      error.textContent = err instanceof TypeError
        ? 'Không kết nối được với trợ lý. Hãy kiểm tra mạng hoặc thử lại sau.'
        : (err.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
      error.hidden = false;
    } finally {
      busy = false;
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
  root.querySelectorAll('[data-chat-prompt]').forEach((button) => {
    button.addEventListener('click', () => ask(button.getAttribute('data-chat-prompt')));
  });
})();
