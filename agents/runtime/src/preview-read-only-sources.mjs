const RAW_CONTENT_ORIGIN = "https://raw.githubusercontent.com/manhdungub-boop/ai-thuc-chien-blog/main/";
const MAX_SOURCE_BYTES = 512 * 1024;
const SOURCE_TIMEOUT_MS = 8_000;
const MAX_SOURCE_TIMEOUT_MS = 30_000;

function abortError(signal) {
  return signal?.reason?.message === "preview_source_timeout"
    ? new Error("preview_source_timeout")
    : new Error("task_execution_aborted");
}

async function readBoundedResponse(response, limit, signal) {
  if (!response || !response.ok) throw new Error("preview_source_http_error_raw_" + (response?.status || "unknown"));
  if (!response.body) throw new Error("preview_source_body_unavailable");
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) throw new Error("preview_source_too_large");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw abortError(signal);
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError(signal);
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch {}
        throw new Error("preview_source_too_large");
      }
      chunks.push(value);
    }
  } finally {
    if (signal?.aborted) { try { await reader.cancel(signal.reason); } catch {} }
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

function isAllowedRawRedirect(location, requestUrl, relativePath) {
  let target;
  try {
    target = new URL(location, requestUrl);
  } catch {
    return false;
  }
  const expectedPath = "/manhdungub-boop/ai-thuc-chien-blog/main/" + relativePath;
  return target.protocol === "https:" &&
    target.hostname === "raw.githubusercontent.com" &&
    target.port === "" &&
    target.username === "" &&
    target.password === "" &&
    target.pathname === expectedPath &&
    target.hash === "";
}

async function fetchRepositoryResponse(url, relativePath, signal) {
  try {
    let response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/plain", "User-Agent": "DUNG-AI-Preview-Source-Reader/1.0" },
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || !isAllowedRawRedirect(location, url, relativePath)) {
        throw new Error("preview_source_redirect_rejected_raw_" + response.status);
      }
      const target = new URL(location, url);
      response = await fetch(target.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/plain", "User-Agent": "DUNG-AI-Preview-Source-Reader/1.0" },
        signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error("preview_source_redirect_rejected_raw_" + response.status);
      }
    }
    if (!response.ok) throw new Error("preview_source_http_error_raw_" + response.status);
    if (signal?.aborted) throw new Error("task_execution_aborted");
    return response;
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    if (error?.name === "AbortError") throw new Error("task_execution_aborted");
    if (/^preview_source_(?:http_error|redirect_rejected)_raw_\d{3}$/.test(error?.message || "")) throw error;
    throw new Error("preview_source_fetch_failed");
  }
}

async function readRepositoryText(relativePath, { signal, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  if (typeof relativePath !== "string" ||
      !/^(?:articles\/[a-z0-9][a-z0-9-]{0,150}\.html|data\/ai-tools\.json)$/.test(relativePath)) {
    throw new Error("preview_source_path_not_allowlisted");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_SOURCE_TIMEOUT_MS) {
    throw new Error("preview_source_timeout_invalid");
  }
  const url = RAW_CONTENT_ORIGIN + relativePath;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason ?? new Error("task_execution_aborted"));
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("preview_source_timeout")), timeoutMs);
  try {
    const response = await fetchRepositoryResponse(url, relativePath, controller.signal);
    return await readBoundedResponse(response, MAX_SOURCE_BYTES, controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

/**
 * Narrow read-only Preview source adapter.
 * All repository URLs are fixed to the public GitHub repository's main branch.
 * No caller-provided host, URL, credential, or write capability is accepted.
 * Direct raw-content reads avoid the unauthenticated GitHub API rate limit.
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
  repository: "manhdungub/ai-thuc-chien-blog",
  ref: "main",
  maxSourceBytes: MAX_SOURCE_BYTES,
  maxFetchDurationMs: SOURCE_TIMEOUT_MS,
  writable: false,
  callerControlledUrls: false,
  seoAuditEnabled: false,
});
