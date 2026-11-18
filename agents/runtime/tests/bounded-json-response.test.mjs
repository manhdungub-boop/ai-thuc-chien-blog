import { describe, expect, it } from "vitest";
import { readBoundedJsonResponse } from "../src/bounded-json-response.mjs";

function response(body, headers = { "content-type": "application/json" }) {
  return new Response(body, { status: 200, headers });
}

describe("bounded upstream JSON response parser", () => {
  it("parses JSON whose encoded body is exactly within the byte limit", async () => {
    const body = JSON.stringify({ ok: true, label: "Tiếng Việt" });
    const result = await readBoundedJsonResponse(response(body), new TextEncoder().encode(body).byteLength);
    expect(result).toEqual({ ok: true, label: "Tiếng Việt" });
  });

  it("rejects an oversized declared Content-Length before reading the body", async () => {
    const result = response("{}", {
      "content-type": "application/json",
      "content-length": "2048"
    });
    await expect(readBoundedJsonResponse(result, 32)).rejects.toThrow("upstream_json_body_too_large");
  });

  it("rejects a streamed body that exceeds the limit even without Content-Length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":'));
        controller.enqueue(new TextEncoder().encode("true," + '"padding":"' + "x".repeat(128) + '"}'));
        controller.close();
      }
    });
    const result = new Response(stream, { headers: { "content-type": "application/json" } });
    await expect(readBoundedJsonResponse(result, 64)).rejects.toThrow("upstream_json_body_too_large");
  });

  it("rejects non-JSON media types and absent bodies", async () => {
    await expect(readBoundedJsonResponse(response("{}", { "content-type": "text/plain" }), 32))
      .rejects.toThrow("upstream_json_content_type_rejected");
    await expect(readBoundedJsonResponse(new Response(null, { headers: { "content-type": "application/json" } }), 32))
      .rejects.toThrow("upstream_json_body_missing");
  });

  it("rejects invalid UTF-8 and malformed JSON", async () => {
    const invalidUtf8 = new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } });
    const malformed = response("{");
    await expect(readBoundedJsonResponse(invalidUtf8, 32)).rejects.toThrow();
    await expect(readBoundedJsonResponse(malformed, 32)).rejects.toThrow();
  });

  it("rejects invalid limits and malformed Content-Length", async () => {
    await expect(readBoundedJsonResponse(response("{}"), 0)).rejects.toThrow("invalid_bounded_json_response_input");
    await expect(readBoundedJsonResponse(response("{}", {
      "content-type": "application/json",
      "content-length": "2x"
    }), 32)).rejects.toThrow("upstream_json_body_too_large");
  });
});
