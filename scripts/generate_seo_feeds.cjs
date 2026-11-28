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

function getPublicationDate(html, file) {
  const match = html.match(/"datePublished"\s*:\s*"([^"]*)"/i);
  if (!match) return null;
  const value = match[1];
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  const parts = dateOnly || dateTime;
  if (!parts) throw new Error('Invalid datePublished metadata in ' + file + ': ' + value);

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error('Invalid calendar datePublished metadata in ' + file + ': ' + value);
  }

  if (dateTime) {
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = Number(parts[6]);
    const zone = parts[8];
    if (hour > 23 || minute > 59 || second > 59) {
      throw new Error('Invalid time datePublished metadata in ' + file + ': ' + value);
    }
    if (zone !== 'Z') {
      const offset = zone.slice(1).replace(':', '');
      if (Number(offset.slice(0, 2)) > 23 || Number(offset.slice(2, 4)) > 59) {
        throw new Error('Invalid timezone datePublished metadata in ' + file + ': ' + value);
      }
    }
  }

  const timestamp = Date.parse(dateOnly ? value + 'T00:00:00Z' : value);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid datePublished metadata in ' + file + ': ' + value);
  return { value, timestamp, pubDate: new Date(timestamp).toUTCString() };
}

function getTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return match[1]
    .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, ' ')
    .replace(/<style\b[\s\S]*?(?:<\/style\s*>|$)/gi, ' ')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .trim();
}

function getCanonical(html, file) {
  const tag = (html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [])[0] || '';
  const match = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
  const canonical = match ? match[1].trim() : '';
  let parsed;
  try { parsed = new URL(canonical); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:' || parsed.origin !== SITE || parsed.username || parsed.password) {
    throw new Error('Missing or invalid canonical URL in ' + file);
  }
  return parsed.href;
}

function validatePageMetadata(html, file) {
  const title = getTitle(html);
  const description = getMetaContent(html, 'description');
  if (!title || !description) {
    throw new Error('Missing title or meta description in ' + file);
  }
  const publication = getPublicationDate(html, file);
  return {
    canonical: getCanonical(html, file),
    title,
    description,
    lastmod: getLastModified(html),
    publishedAt: publication ? publication.timestamp : null,
    pubDate: publication ? publication.pubDate : ''
  };
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
    if (new URL(metadata.canonical).pathname.split('/')[1] !== 'articles') {
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

  // RSS readers and the social draft workflow consume feed order. Sort by
  // declared datePublished (never dateModified or file name); undated entries
  // remain visible but follow dated articles and are not assigned invented dates.
  const rssArticles = articles.slice().sort((a, b) => {
    if (a.publishedAt === null && b.publishedAt === null) return a.canonical.localeCompare(b.canonical);
    if (a.publishedAt === null) return 1;
    if (b.publishedAt === null) return -1;
    return b.publishedAt - a.publishedAt || a.canonical.localeCompare(b.canonical);
  });

  const rssItems = rssArticles.map((article) => {
    const lines = [
      '  <item>',
      '    <title>' + escapeXml(article.title) + '</title>',
      '    <link>' + escapeXml(article.canonical) + '</link>',
      '    <guid isPermaLink="true">' + escapeXml(article.canonical) + '</guid>',
      '    <description>' + escapeXml(article.description) + '</description>'
    ];
    if (article.pubDate) lines.push('    <pubDate>' + escapeXml(article.pubDate) + '</pubDate>');
    lines.push('  </item>');
    return lines.join('\n');
  });

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
  console.log('SEO FEEDS GENERATED: ' + articles.length + ' homepage-linked articles; RSS ordered by datePublished, with undated entries retained at the end.');
}

module.exports = generate;
module.exports.getPublicationDate = getPublicationDate;
