const fs = require('node:fs');
const path = require('node:path');

const SITE = 'https://ai-thuc-chien-blog.manhdungub-boop.workers.dev';

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getMetaContent(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i);
    const property = tag.match(/\bproperty\s*=\s*["']([^"']+)["']/i);
    const attr = (name && name[1].toLowerCase() === key.toLowerCase()) ||
      (property && property[1].toLowerCase() === key.toLowerCase());
    if (!attr) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (content) return content[1].trim();
  }
  return '';
}

function getTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function generate(outputDir) {
  const articlesDir = path.join(outputDir, 'articles');
  const files = fs.readdirSync(articlesDir)
    .filter((name) => name.endsWith('.html'))
    .sort();

  const articles = files.map((file) => {
    const html = fs.readFileSync(path.join(articlesDir, file), 'utf8');
    const canonicalMatch = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i);
    const canonicalTag = canonicalMatch ? canonicalMatch[0] : '';
    const canonicalValue = canonicalTag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const canonical = canonicalValue ? canonicalValue[1].trim() : '';
    const title = getTitle(html);
    const description = getMetaContent(html, 'description');

    if (!canonical || !canonical.startsWith(SITE + '/articles/')) {
      throw new Error('Missing or invalid canonical URL in ' + file);
    }
    if (!title || !description) {
      throw new Error('Missing title or meta description in ' + file);
    }

    return { canonical, title, description, file };
  });

  const today = new Date().toISOString().slice(0, 10);
  const sitemapEntries = [
    '  <url>',
    '    <loc>' + escapeXml(SITE + '/')</loc>',
    '    <lastmod>' + today + '</lastmod>',
    '  </url>'
  ];
  for (const article of articles) {
    sitemapEntries.push(
      '  <url>',
      '    <loc>' + escapeXml(article.canonical) + '</loc>',
      '    <lastmod>' + today + '</lastmod>',
      '  </url>'
    );
  }

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapEntries,
    '</urlset>',
    ''
  ].join('\n');

  const rssItems = articles.slice().reverse().map((article) => [
    '  <item>',
    '    <title>' + escapeXml(article.title) + '</title>',
    '    <link>' + escapeXml(article.canonical) + '</link>',
    '    <guid isPermaLink="true">' + escapeXml(article.canonical) + '</guid>',
    '    <description>' + escapeXml(article.description) + '</description>',
    '  </item>'
  ].join('\n'));

  const feed = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    '    <title>AI Thực Chiến</title>',
    '    <link>' + escapeXml(SITE + '/') + '</link>',
    '    <description>Kiến thức AI thực hành, tự động hóa và công nghệ.</description>',
    ...rssItems,
    '  </channel>',
    '</rss>',
    ''
  ].join('\n');

  fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'feed.xml'), feed, 'utf8');
  console.log('SEO FEEDS GENERATED: ' + articles.length + ' articles.');
}

module.exports = generate;
