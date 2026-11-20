import { describe, expect, it } from "vitest";
import { readBoundedJson } from "../src/bounded-json-body.mjs";

const url = "https://agent-runtime.test/request";

function request(body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers,
    body,
    duplex: "half"
  });
}

describe("bounded streaming JSON request reader", () => {
  it("rejects an invalid Content-Length before reading the body", async () => {
    let pulled = false;
    const stream = new ReadableStream({
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      }
    }, { highWaterMark: 0 });
    const result = await readBoundedJson(request(stream, { "content-length": "2x" }), 32);
    expect(result).toEqual({ ok: false, status: 400, error: "invalid_content_length" });
    expect(pulled).toBe(false);
  });

  it("rejects a declared oversized body before reading", async () => {
    let pulled = false;
    const stream = new ReadableStream({
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.close();
      }
    }, { highWaterMark: 0 });
    const result = await readBoundedJson(request(stream, { "content-length": "33" }), 32);
    expect(result).toEqual({ ok: false, status: 413, error: "request_body_too_large" });
    expect(pulled).toBe(false);
  });

  it("cancels an oversized streamed body when Content-Length is absent", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(33));
      },
      cancel() {
        cancelled = true;
      }
    });
    const result = await readBoundedJson(request(stream), 32);
    expect(result).toEqual({ ok: false, status: 413, error: "request_body_too_large" });
    expect(cancelled).toBe(true);
  });

  it("accepts a valid JSON body exactly at the byte limit", async () => {
    const body = '{"a":"' + "12345678" + '"}';
    expect(new TextEncoder().encode(body).byteLength).toBe(16);
    const result = await readBoundedJson(request(body), 16);
    expect(result).toEqual({ ok: true, value: { a: "12345678" } });
  });

  it("rejects a declared length that does not match the streamed bytes", async () => {
    const result = await readBoundedJson(request("{}", { "content-length": "3" }), 32);
    expect(result).toEqual({ ok: false, status: 400, error: "invalid_content_length" });
  });

  it("rejects invalid UTF-8 and malformed JSON", async () => {
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
    const utf8Result = await readBoundedJson(request(new Blob([invalidUtf8])), 32);
    expect(utf8Result).toEqual({ ok: false, status: 400, error: "invalid_json_encoding" });
    const jsonResult = await readBoundedJson(request("{"), 32);
    expect(jsonResult).toEqual({ ok: false, status: 400, error: "invalid_json" });
  });
});
