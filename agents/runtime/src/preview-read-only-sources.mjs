const GITHUB_CONTENTS_ORIGIN = "https://api.github.com/repos/manhdungub-boop/ai-thuc-chien-blog/contents/";
const MAX_SOURCE_BYTES = 512 * 1024;

async function readBoundedResponse(response, limit, signal) {
  if (!response || !response.ok) throw new Error("preview_source_http_error");
  if (!response.body) throw new Error("preview_source_body_unavailable");
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) throw new Error("preview_source_too_large");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new Error("task_execution_aborted");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error("task_execution_aborted");
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch {}
        throw new Error("preview_source_too_large");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("preview_source_invalid_utf8");
  }
}

async function readRepositoryText(relativePath, { signal } = {}) {
  if (typeof relativePath !== "string" ||
      !/^(?:articles\/[a-z0-9][a-z0-9-]{0,150}\.html|data\/ai-tools\.json)$/.test(relativePath)) {
    throw new Error("preview_source_path_not_allowlisted");
  }
  const url = GITHUB_CONTENTS_ORIGIN + relativePath + "?ref=main";
  if (signal?.aborted) throw new Error("task_execution_aborted");
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
    });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw new Error("task_execution_aborted");
    throw new Error("preview_source_fetch_failed");
  }
  if (signal?.aborted) throw new Error("task_execution_aborted");
  return readBoundedResponse(response, MAX_SOURCE_BYTES, signal);
}

/**
 * Narrow read-only Preview source adapter.
 * All repository URLs are fixed to the public GitHub repository's main branch.
 * No caller-provided host, URL, credential, or write capability is accepted.
 */
export function createPreviewReadOnlyReaders() {
  return Object.freeze({
    async readArticleHtml(articlePath, options) {
      return readRepositoryText(articlePath, options);
    },
    async readAiBankCatalog(options) {
      const text = await readRepositoryText("data/ai-tools.json", options);
      const catalog = JSON.parse(text);
      if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) ||
          !Array.isArray(catalog.tools) || catalog.tools.length > 1000) {
        throw new Error("preview_ai_bank_catalog_invalid");
      }
      return catalog;
    },
    async readSeoPage() {
      // HTTP status and broken-link evidence are not yet sourced by a trusted,
      // bounded same-origin auditor. Do not fabricate a clean SEO result.
      throw new Error("seo_live_evidence_unavailable");
    },
  });
}

export const PREVIEW_READ_ONLY_SOURCE_POLICY = Object.freeze({
  repository: "manhdungub-boop/ai-thuc-chien-blog",
  ref: "main",
  maxSourceBytes: MAX_SOURCE_BYTES,
  writable: false,
  callerControlledUrls: false,
  seoAuditEnabled: false,
});
