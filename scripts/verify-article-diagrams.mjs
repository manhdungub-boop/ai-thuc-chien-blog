import fs from "node:fs";
import path from "node:path";

const directory = "articles";
const files = fs.readdirSync(directory).filter(name => name.endsWith(".html")).sort();
const failures = [];
const seenSlugs = new Set();
for (const file of files) {
  const slug = path.basename(file, ".html");
  const source = fs.readFileSync(path.join(directory, file), "utf8");
  const figures = [...source.matchAll(/<figure\b[^>]*class=["']article-diagram["'][^>]*>[\s\S]*?<\/figure>/gi)];
  if (figures.length !== 1) { failures.push(`${file}: expected exactly one article diagram, found ${figures.length}`); continue; }
  const figure = figures[0][0];
  const dataSlug = figure.match(/data-article-diagram=["']([^"']+)["']/i)?.[1];
  if (dataSlug !== slug) failures.push(`${file}: diagram slug does not match filename`);
  if (seenSlugs.has(dataSlug)) failures.push(`${file}: duplicate diagram slug ${dataSlug}`);
  seenSlugs.add(dataSlug);
  const titleId = figure.match(/<title\s+id=["']([^"']+)["']/i)?.[1];
  const descId = figure.match(/<desc\s+id=["']([^"']+)["']/i)?.[1];
  const svg = figure.match(/<svg\b[^>]*>/i)?.[0] || "";
  const labelledBy = svg.match(/aria-labelledby=["']([^"']+)["']/i)?.[1]?.split(/\s+/) || [];
  if (!titleId || !descId || !labelledBy.includes(titleId) || !labelledBy.includes(descId)) failures.push(`${file}: SVG title/description are not correctly connected to ARIA labels`);
  if (!/role=["']img["']/i.test(svg)) failures.push(`${file}: SVG is missing role=img`);
  if (!/<figcaption\b/i.test(figure)) failures.push(`${file}: missing explanatory figcaption`);
  if ((figure.match(/<rect\b/gi) || []).length !== 3 || (figure.match(/<circle\b/gi) || []).length !== 3) failures.push(`${file}: expected three distinct diagram steps`);
  if (/<(?:img|image)\b|href=["']https?:/i.test(figure)) failures.push(`${file}: diagram unexpectedly depends on external image assets`);
  const ids = [...figure.matchAll(/\bid=["']([^"']+)["']/gi)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) failures.push(`${file}: duplicate SVG IDs within diagram`);
  const h1End = source.search(/<\/h1>/i);
  const figureAt = source.indexOf(figure);
  const firstHr = h1End < 0 ? -1 : source.slice(h1End + 5).search(/<hr\b/i);
  if (h1End < 0 || (firstHr >= 0 && figureAt > h1End + 5 + firstHr)) failures.push(`${file}: diagram is not placed in the article introduction area`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${files.length} article pages each contain one unique, accessible, self-contained SVG roadmap.`);
}
