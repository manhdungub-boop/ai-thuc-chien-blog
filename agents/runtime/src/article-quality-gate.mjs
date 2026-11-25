const MIN_WORDS = 600;
const MAX_WORDS = 2500;
const MIN_SOURCES = 3;
const MIN_SECTIONS = 4;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function removeFencedCode(markdown) {
  const kept = [];
  let fence = null;
  for (const line of markdown.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    if (fence) {
      const closing = new RegExp("^ {0,3}" + fence.character + "{" + fence.length + ",}[ \\t]*$");
      if (closing.test(line)) fence = null;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function markdownText(markdown) {
  return markdown
    .replace(/`+([^`]*?)`+/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  if (!text(source.title) || !text(source.publisher)) return false;
  if (!text(source.accessed_at) || !Number.isFinite(Date.parse(source.accessed_at))) return false;
  try {
    const url = new URL(source.url);
    return url.protocol === "https:" && Boolean(url.hostname) &&
      !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function reviewArticleDraft(draft) {
  const issues = [];
  const add = (code, detail) => issues.push({ code, detail });

  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return {
      ok: false,
      status: "invalid_draft",
      issues: [{ code: "draft_not_object", detail: "Draft must be a structured object." }],
      publication_authorized: false
    };
  }

  const title = text(draft.title);
  const slug = text(draft.slug);
  const description = text(draft.meta_description);
  const body = text(draft.body_markdown);
  const author = text(draft.author);
  const copyrightNotice = text(draft.copyright_notice);
  const proseBody = removeFencedCode(body);
  const sections = [...proseBody.matchAll(/^#{2,3}\s+\S.+$/gm)];
  const plainBody = markdownText(proseBody);
  const words = plainBody ? plainBody.split(/\s+/).filter(Boolean).length : 0;
  const sources = Array.isArray(draft.sources) ? draft.sources : [];
  const uniqueUrls = new Set();
  const validSources = [];
  const validSourceIndexes = new Set();

  if (title.length < 35 || title.length > 70) add("title_length", "Title must contain 35–70 characters.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) add("slug_format", "Slug must be lowercase ASCII words separated by hyphens.");
  if (description.length < 120 || description.length > 160) add("meta_description_length", "Meta description must contain 120–160 characters.");
  if (author !== "DUNG - AI") add("author_attribution", "Author must be exactly DUNG - AI.");
  if (draft.language !== "vi") add("language", "Draft language must be Vietnamese (vi).");
  if (words < MIN_WORDS || words > MAX_WORDS) add("body_word_count", "Article body must contain 600–2,500 whitespace-delimited words.");
  if (sections.length < MIN_SECTIONS) add("section_count", "Article must contain at least four H2/H3 sections.");
  if (!/©|bản quyền|quyền tác giả/i.test(copyrightNotice)) add("copyright_notice", "A clear copyright/attribution notice is required.");
  if (/<\s*script\b|javascript:|data:text\/html/i.test(proseBody)) add("unsafe_markup", "Potentially unsafe active markup or URL scheme detected.");

  for (const [index, source] of sources.entries()) {
    if (!validSource(source)) {
      add("invalid_source", "Every source needs a title, publisher, valid access date, and HTTPS URL.");
      continue;
    }
    const normalized = new URL(source.url).href;
    if (uniqueUrls.has(normalized)) {
      add("duplicate_source", "Duplicate source URLs are not allowed.");
      continue;
    }
    uniqueUrls.add(normalized);
    validSources.push(source);
    validSourceIndexes.add(index);
  }

  if (validSources.length < MIN_SOURCES) add("source_count", "At least three distinct, valid HTTPS sources are required.");

  const citationProse = proseBody.replace(/`+[^`]*?`+/g, " ").replace(/!?\[[^\]]*\]\([^)]*\)/g, " ");
  const citationNumbers = [...citationProse.matchAll(/\[(\d{1,2})\]/g)].map(match => Number(match[1]));
  if (!citationNumbers.length) {
    add("missing_inline_citations", "Add inline numeric citations such as [1] that correspond to the source list.");
  } else if (citationNumbers.some(number => number < 1 || number > sources.length || !validSourceIndexes.has(number - 1))) {
    add("citation_reference_mismatch", "Every inline citation must refer to a valid source-list position.");
  }

  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "eligible_for_human_review" : "needs_revision",
    metrics: {
      word_count: words,
      section_count: sections.length,
      source_count: validSources.length,
      title_characters: title.length,
      meta_description_characters: description.length
    },
    issues,
    review_notice: "A deterministic structure and safety check only. It does not verify factual accuracy, source credibility, originality, copyright ownership, SEO performance, or publication readiness.",
    publication_authorized: false
  };
}
