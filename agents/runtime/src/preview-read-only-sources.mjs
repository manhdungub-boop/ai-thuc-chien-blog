const GITHUB_RAW_ORIGIN = "https://raw.githubusercontent.com/manhdungub-boop/ai-thuc-chien-blog/main/";
const MAX_SOURCE_BYTES = 512 * 1024;

async function readBoundedResponse(response, limit, signal) {
  if (!response || !response.ok) throw new Error("preview_source_http_error_body_" + (response?.status || "unknown"));
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

async function fetchRepositoryResponse(url, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/plain" },
      signal,
    });
    // The source URL is pinned to the public repository and branch. Do not
    // follow redirects: this avoids redirect ambiguity and API rate limits.
    if (response.status >= 300 && response.status < 400) {
      throw new Error("preview_source_redirect_rejected_raw_" + response.status);
    }
    if (!response.ok) {
      throw new Error("preview_source_http_error_raw_" + response.status);
    }
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") {
      throw new Error("task_execution_aborted");
    }
    if (/^preview_source_(?:http_error|redirect_rejected)_raw_\d{3}$/.test(error?.message || "")) throw error;
    throw new Error("preview_source_fetch_failed");
  }
  if (signal?.aborted) throw new Error("task_execution_aborted");
  return response;
}


