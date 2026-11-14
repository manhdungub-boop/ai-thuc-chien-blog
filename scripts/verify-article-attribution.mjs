import fs from "node:fs";
import path from "node:path";

const articleDir = "articles";
const files = fs.readdirSync(articleDir).filter(file => file.endsWith(".html")).sort();
const failures = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(articleDir, file), "utf8");
  if (!/<meta\b(?=[^>]*name=["']author["'])(?=[^>]*content=["']DUNG - AI["'])[^>]*>/i.test(source)) failures.push(`${file}: meta author is not DUNG - AI`);
  const jsonld = [...source.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  let authorFound = false;
  let publisherFound = false;
  for (const block of jsonld) {
    try {
      const data = JSON.parse(block);
      const author = data.author;
      if (data["@type"] === "BlogPosting" && author?.["@type"] === "Person" && author.name === "DUNG - AI") authorFound = true;
      if (data["@type"] === "BlogPosting" && data.publisher?.["@type"] === "Organization" && data.publisher.name === "AI Thực Chiến") publisherFound = true;
    } catch { failures.push(`${file}: invalid JSON-LD`); }
  }
  if (!authorFound) failures.push(`${file}: BlogPosting author Person DUNG - AI missing`);
  if (!publisherFound) failures.push(`${file}: publisher Organization AI Thực Chiến missing`);
  if (!/<p\b[^>]*class=["'][^"']*article-byline[^"']*["'][^>]*>[\s\S]*?<strong>\s*Tác giả:\s*<\/strong>\s*DUNG - AI/i.test(source)) failures.push(`${file}: visible DUNG - AI byline missing`);
  if (!/<section\b[^>]*class=["'][^"']*article-author-note[^"']*["'][\s\S]*?DUNG - AI[\s\S]*?(?:bài viết gốc|liên kết về bài viết)/i.test(source)) failures.push(`${file}: attribution/reuse note missing`);
}
const home = fs.readFileSync("index.html", "utf8");
if (!/<meta\b(?=[^>]*name=["']author["'])(?=[^>]*content=["']DUNG - AI["'])[^>]*>/i.test(home)) failures.push("index.html: meta author is not DUNG - AI");
if (!/71 bài thực hành/i.test(home)) failures.push("index.html: article count is not 71");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS: visible byline, meta author, BlogPosting Person author, Organization publisher and attribution note verified on ${files.length} articles; homepage author/count verified.`);
}
