'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const htmlFiles = [
  ...fs.readdirSync(root).filter((name) => name.endsWith('.html') && name !== 'google4e45ddcf8facb122.html'),
  ...fs.readdirSync(path.join(root, 'articles')).filter((name) => name.endsWith('.html')).map((name) => path.join('articles', name)),
];
assert.ok(htmlFiles.length >= 13, 'Expected homepage, utility pages, 404 and article pages');
const fontUrl = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap';
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(html.includes('<a class="skip-link" href="#main-content">Bỏ qua đến nội dung chính</a>'), `${file}: missing keyboard skip link`);
  assert.match(html, /<main\b[^>]*\bid="main-content"/i, `${file}: main landmark needs main-content id`);
  assert.ok(html.includes('<link rel="preconnect" href="https://fonts.googleapis.com">'), `${file}: missing Google Fonts preconnect`);
  assert.ok(html.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'), `${file}: missing font asset preconnect`);
  assert.ok(html.includes('<link href="' + fontUrl + '" rel="stylesheet">'), `${file}: font stylesheet must be discoverable from HTML`);
}
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
assert.doesNotMatch(css, /^\s*@import\b/m, 'Avoid CSS @import because it delays font discovery');
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'Respect reduced-motion preference');
assert.match(css, /\.skip-link:focus/, 'Skip link must become visible to keyboard users');
const appScript = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const chatLauncherMatch = appScript.match(/<button class="reader-chat-launcher"[^>]*>[\s\S]*?<\/button>/);
assert.ok(chatLauncherMatch, 'AI chat launcher markup is missing');
assert.doesNotMatch(chatLauncherMatch[0], /\baria-label\s*=/i, 'Use visible text as the AI chat launcher's accessible name');
assert.match(chatLauncherMatch[0], /class="reader-chat-launcher-label">Hỏi AI<\/span>/, 'AI chat launcher needs a visible text label');
assert.match(appScript, /launcher\.querySelector\('\.reader-chat-launcher-label'\)\.textContent\s*=\s*open\s*\?\s*'Đóng chat'\s*:\s*'Hỏi AI'/, 'AI chat launcher visible label must remain synchronized as it opens and closes');
console.log(`ACCESSIBILITY/PERFORMANCE PASS: ${htmlFiles.length} HTML pages, early font discovery, skip navigation, reduced motion.`);
