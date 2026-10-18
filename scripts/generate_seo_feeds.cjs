'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = function generateSeoFeeds(outputDir, baseUrl = 'https://ai-thuc-chien-blog.manhdungub.workers.dev') {
  const articlesDir = path.join(outputDir, 'articles');
  const articleFiles = fs.readdirSync(articlesDir).filter((name) => name.endsWith('.html')).sort();
  const escapeXml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;');
  const getMeta = (html, name) => {
    const tags = html.match(/<meta\\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const nameMatch = tag.match(/\\bname\\s*=\\s*[\"']([^\"']+)[\"']/i);
      const contentMatch = tag.match(/\\bcontent\\s*=\\s*[\"']([^\"']*)[\"']/i);
      if (nameMatch && contentMatch && nameMatch[1].toLowerCase() === name.toLowerCase()) return contentMatch[1];
    }
    return '';
  };
  const articles = articleFiles.map((file) => {
    const html = fs.readFileSync(path.join(articlesDir, file), 'utf8');
    const canonicalMatch = html.match(/<link\\b[^>]*rel\\s*=\\s*[\"']canonical[\"'][^>]*href\\s*=\\s*[\"']([^\"']+)[\"']/i);
    const titleMatch = html.match(/<title>([\\s\\S]*?)<\\/title>/i);
    const canonical = canonicalMatch ? canonicalMatch[1] : '';
    const title = titleMatch ? titleMatch[1].trim() : '';
    const description = getMeta(html, 'description');
    if (!canonical || !canonical.startsWith(baseUrl + '/articles/') || canonical.endsWith('.html')) throw new Error(file + ': canonical URL missing or not extensionless');
    if (!title || !description) throw new Error(file + ': title or meta description is missing');
    return { url: canonical, title, description };
  });
  const today = new Date().toISOString().slice(0, 10);
  const urls = [{ url: baseUrl + '/', priority: '1.0' }].concat(articles.map((article) => ({ url: article.url, priority: '0.8' })));
  const sitemap = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\\n' + urls.map((item) => '  <url><loc>' + escapeXml(item.url) + '</loc><lastmod>' + today + '</lastmod><priority>' + item.priority + '</priority></url>').join('\\n') + '\\n</urlset>\\n';
  const feedItems = articles.slice().reverse().map((article) => '    <item>\\n      <title>' + escapeXml(article.title) + '</title>\\n      <link>' + escapeXml(article.url) + '</link>\\n      <guid isPermaLink=\"true\">' + escapeXml(article.url) + '</guid>\\n      <description>' + escapeXml(article.description) + '</description>\\n    </item>').join('\\n');
  const feed = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\\n<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\">\\n  <channel>\\n    <title>AI Thực Chiến</title>\\n    <link>' + escapeXml(baseUrl + '/') + '</link>\\n    <description>Hướng dẫn AI dễ áp dụng, công cụ miễn phí và quy trình tự động hóa cho công việc thực tế.</description>\\n    <language>vi-VN</language>\\n    <atom:link href=\"' + escapeXml(baseUrl + '/feed.xml') + '\" rel=\"self\" type=\"application/rss+xml\" />\\n' + feedItems + '\\n  </channel>\\n</rss>\\n';
  fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap);
  fs.writeFileSync(path.join(outputDir, 'feed.xml'), feed);
  console.log('SEO FEEDS PASS: generated sitemap and RSS for ' + articles.length + ' articles.');
};
