const fs = require('node:fs');
const path = require('node:path');

const SITE = 'https://ai-thuc-chien-blog.manhdungub.workers.dev';

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
    const matchesKey =
      (name && name[1].toLowerCase() === key.toLowerCase()) ||
      (property && property[1].toLowerCase() === key.toLowerCase());
    if (!matchesKey) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (content) return content[1].trim();
  }
  return '';
}

function getLastModified(html) {
  const dates = [...html.matchAll(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})(?:T[^"]*)?"/gi)]
    .map((match) => match[1])
    .filter((date) => !Number.isNaN(Date.parse(date + 'T00:00:00Z')));
  return dates.sort().pop() || '';
}

function getTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function getCanonical(html, file) {
  const tag = (html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [])[0] || '';
  const match = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
  const canonical = match ? match[1].trim() : '';
  if (!canonical || !canonical.startsWith(SITE + '/')) {
    throw new Error('Missing or invalid canonical URL in ' + file);
  }
  return canonical;
}

function validatePageMetadata(html, file) {
  const title = getTitle(html);
  const description = getMetaContent(html, 'description');
  if (!title || !description) {
    throw new Error('Missing title or meta description in ' + file);
  }
  return { canonical: getCanonical(html, file), title, description, lastmod: getLastModified(html) };
}

function getPublishedArticleFiles(outputDir) {
  const discoveryPages = ['index.html', 'thu-vien.html']
    .filter((name) => fs.existsSync(path.join(outputDir, name)))
    .map((name) => fs.readFileSync(path.join(outputDir, name), 'utf8'));
  const links = discoveryPages.flatMap((page) =>
    [...page.matchAll(/\bhref=["'](?:\/|\.\/|\.\.\/|)?articles\/([^"'#?]+)["']/gi)]
      .map((match) => match[1].replace(/\.html$/i, '') + '.html')
  );
  const unique = [...new Set(links)];
  for (const file of unique) {
    if (file.includes('/') || file.includes('\\')) {
      throw new Error('Invalid homepage article path: ' + file);
    }
    if (!fs.existsSync(path.join(outputDir, 'articles', file))) {
      throw new Error('Homepage links to missing article: ' + file);
    }
  }
  if (unique.length === 0) {
    throw new Error('Homepage has no published article links');
  }
  return new Set(unique);
}

function generate(outputDir) {
  const articlesDir = path.join(outputDir, 'articles');
  const publishedFiles = getPublishedArticleFiles(outputDir);
  const files = fs.readdirSync(articlesDir)
    .filter((name) => name.endsWith('.html') && publishedFiles.has(name))
    .sort();

  const articles = files.map((file) => {
    const html = fs.readFileSync(path.join(articlesDir, file), 'utf8');
    const metadata = validatePageMetadata(html, 'articles/' + file);
    if (!metadata.canonical.startsWith(SITE + '/articles/')) {
      throw new Error('Article canonical must use /articles/ path in ' + file);
    }
    if (metadata.canonical.endsWith('.html')) {
      throw new Error('Article canonical must remain extensionless in ' + file);
    }
    return metadata;
  });

  const aboutPath = path.join(outputDir, 've-chung-toi.html');
  const aboutHtml = fs.readFileSync(aboutPath, 'utf8');
  const about = validatePageMetadata(aboutHtml, 've-chung-toi.html');
  if (about.canonical !== SITE + '/ve-chung-toi.html') {
    throw new Error('About page canonical URL must match the deployed /ve-chung-toi.html route');
  }

  const aiBankPath = path.join(outputDir, 'ngan-hang-ai.html');
  const aiBankHtml = fs.readFileSync(aiBankPath, 'utf8');
  const aiBank = validatePageMetadata(aiBankHtml, 'ngan-hang-ai.html');
  if (aiBank.canonical !== SITE + '/ngan-hang-ai.html') {
    throw new Error('AI bank canonical URL must match /ngan-hang-ai.html');
  }

  const libraryPath = path.join(outputDir, 'thu-vien.html');
  const libraryHtml = fs.readFileSync(libraryPath, 'utf8');
  const library = validatePageMetadata(libraryHtml, 'thu-vien.html');
  if (library.canonical !== SITE + '/thu-vien.html') {
    throw new Error('Topic library canonical URL does not match /thu-vien.html');
  }

  const sitemapEntries = [
    { canonical: SITE + '/' },
    about,
    library,
    aiBank,
    ...articles
  ].map((page) => {
    const lines = [
      '  <url>',
      '    <loc>' + escapeXml(page.canonical) + '</loc>'
    ];
    if (page.lastmod) lines.push('    <lastmod>' + escapeXml(page.lastmod) + '</lastmod>');
    lines.push('  </url>');
    return lines.join('\n');
  });

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
    '    <description>Kiến thức AI thực hành, tự động hóa và công nghệ cho người Việt.</description>',
    ...rssItems,
    '  </channel>',
    '</rss>',
    ''
  ].join('\n');

  fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'feed.xml'), feed, 'utf8');
  console.log('SEO FEEDS GENERATED: ' + articles.length + ' homepage-linked articles + homepage + about + library + AI bank pages.');
}

module.exports = generate;
