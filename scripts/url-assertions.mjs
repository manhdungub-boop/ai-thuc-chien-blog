export function extractAttribute(tag, attributeName) {
  const match = tag.match(new RegExp("\\b" + attributeName + "\\s*=\\s*(['\"])(.*?)\\1", "i"));
  return match?.[2] ?? "";
}

function absoluteUrlsIn(text) {
  return text.match(/https?:\/\/[^\s"'<>]+/g) || [];
}

export function hasUrlWithOrigin(text, expectedOrigin) {
  const expected = new URL(expectedOrigin).origin;
  return absoluteUrlsIn(text).some((candidate) => {
    try {
      return new URL(candidate.replace(/[),.;\]}]+$/, "")).origin === expected;
    } catch {
      return false;
    }
  });
}

export function hasExactUrlReference(text, expectedUrl) {
  const expected = new URL(expectedUrl);
  return absoluteUrlsIn(text).some((candidate) => {
    try {
      const parsed = new URL(candidate.replace(/[),.;\]}]+$/, ""));
      return parsed.origin === expected.origin && parsed.pathname === expected.pathname;
    } catch {
      return false;
    }
  });
}
