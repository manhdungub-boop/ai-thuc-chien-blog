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
