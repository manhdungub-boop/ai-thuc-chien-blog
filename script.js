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


// Site-wide AI reader assistant. Conversation stays in this tab and is not persisted.
(() => {
  // Keep non-browser test harnesses and partial DOM environments unaffected.
  if (!document.body || typeof document.createElement !== 'function' || typeof document.getElementById !== 'function') return;
  if (document.getElementById('reader-ai-chat')) return;
  const apiUrl = 'https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat';
  const root = document.createElement('div');
  root.id = 'reader-ai-chat';
  root.innerHTML = `
    <button class="reader-chat-launcher" type="button" aria-label="Mở trợ lý AI" aria-expanded="false" aria-controls="reader-chat-panel"><span aria-hidden="true">✦</span><span class="reader-chat-launcher-label">Hỏi AI</span></button>
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
