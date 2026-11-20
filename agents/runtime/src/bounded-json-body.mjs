export async function readBoundedJson(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("invalid_body_limit");
  }

  const declared = request.headers.get("content-length");
  let declaredBytes = null;
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)) {
      return { ok: false, status: 400, error: "invalid_content_length" };
    }
    declaredBytes = Number(declared);
    if (!Number.isSafeInteger(declaredBytes)) {
      return { ok: false, status: 400, error: "invalid_content_length" };
    }
    if (declaredBytes > maxBytes) {
      return { ok: false, status: 413, error: "request_body_too_large" };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, error: "invalid_json" };
  }

  const reader = request.body.getReader();
  const chunks = [];
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
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (declaredBytes !== null && declaredBytes !== totalBytes) {
    return { ok: false, status: 400, error: "invalid_content_length" };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 400, error: "invalid_json_encoding" };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}
