export async function readBoundedText(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("invalid_body_limit");
  const contentType = request.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType.trim())) {
    try { await request.body?.cancel("invalid_content_type"); } catch {}
    return { ok: false, status: 400, error: "invalid_content_type" };
  }
  const declared = request.headers.get("content-length");
  let declaredBytes = null;
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)) {
      try { await request.body?.cancel("invalid_content_length"); } catch {}
      return { ok: false, status: 400, error: "invalid_content_length" };
    }
    declaredBytes = Number(declared);
    if (!Number.isSafeInteger(declaredBytes)) {
      try { await request.body?.cancel("invalid_content_length"); } catch {}
      return { ok: false, status: 400, error: "invalid_content_length" };
    }
    if (declaredBytes > maxBytes) {
      try { await request.body?.cancel("request_body_too_large"); } catch {}
      return { ok: false, status: 413, error: "request_body_too_large" };
    }
  }
  if (!request.body) return { ok: false, status: 400, error: "invalid_json" };
  const reader = request.body.getReader(), chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 400, error: "invalid_request_body" };
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request_body_too_large").catch(() => {});
        return { ok: false, status: 413, error: "request_body_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "request_body_unreadable" };
  } finally { try { reader.releaseLock(); } catch {} }
  if (declaredBytes !== null && declaredBytes !== totalBytes) return { ok: false, status: 400, error: "invalid_content_length" };
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }; }
  catch { return { ok: false, status: 400, error: "invalid_json_encoding" }; }
}
export async function readBoundedJson(request, maxBytes) {
  const bounded = await readBoundedText(request, maxBytes);
  if (!bounded.ok) return bounded;
  try { return { ok: true, value: JSON.parse(bounded.value) }; }
  catch { return { ok: false, status: 400, error: "invalid_json" }; }
}
