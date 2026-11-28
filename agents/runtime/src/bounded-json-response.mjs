/**
 * Parse a JSON response without trusting Content-Length or buffering an unbounded body.
 * The caller remains responsible for checking the HTTP status and request timeout.
 */
export async function readBoundedJsonResponse(response, maxBytes) {
  if (!response || !Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("invalid_bounded_json_response_input");
  }
  const contentType = response.headers?.get("content-type") || "";
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
    throw new TypeError("upstream_json_content_type_rejected");
  }
  const lengthHeader = response.headers?.get("content-length");
  if (lengthHeader !== null && lengthHeader !== undefined) {
    if (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > maxBytes) {
      throw new RangeError("upstream_json_body_too_large");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new TypeError("upstream_json_body_missing");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError("upstream_json_chunk_invalid");
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel("upstream_json_body_too_large"); } catch {}
        throw new RangeError("upstream_json_body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text);
}
