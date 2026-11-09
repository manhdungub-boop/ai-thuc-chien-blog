const BASIC_ENTITIES = Object.freeze({
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
});

export function decodeBasicEntities(value) {
  // Decode exactly one HTML-entity layer. Replacement output is never re-scanned.
  return String(value ?? "").replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/gi, (entity, name) => {
    return BASIC_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

export function stripNonContentTags(html) {
  // HTML permits whitespace before '>' in an end tag (for example, </script >).
  return String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ");
}
