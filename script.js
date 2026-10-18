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

// Lightweight client-side article search. It also matches Vietnamese without diacritics.
const articleSearch = document.querySelector('#article-search');
const articleSearchStatus = document.querySelector('#article-search-status');
const searchableArticles = Array.from(document.querySelectorAll('#article-grid .article-card'));
const articleTools = document.querySelector('.article-tools');

if (articleSearch && articleSearchStatus && articleTools && searchableArticles.length) {
  const normalizeSearchText = (value) => value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();

  const filterArticles = () => {
    const query = normalizeSearchText(articleSearch.value);
    let visibleCount = 0;

    searchableArticles.forEach((article) => {
      const searchableText = normalizeSearchText(article.textContent || '');
      const matches = !query || searchableText.includes(query);
      article.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    if (!query) {
      articleSearchStatus.textContent = `Hiển thị tất cả ${searchableArticles.length} bài viết.`;
    } else if (visibleCount) {
      articleSearchStatus.textContent = `Tìm thấy ${visibleCount}/${searchableArticles.length} bài viết phù hợp.`;
    } else {
      articleSearchStatus.textContent = 'Không tìm thấy bài viết phù hợp. Thử từ khóa khác.';
    }
  };

  articleSearch.addEventListener('input', filterArticles);
  articleTools.hidden = false;
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
