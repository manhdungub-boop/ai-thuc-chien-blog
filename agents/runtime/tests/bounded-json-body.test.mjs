import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedJson, readBoundedText } from "../src/bounded-json-body.mjs";
function requestFromStream(stream, headers = {}) {
  return new Request("https://state-store.test/reserve", { method: "POST", headers, body: stream, duplex: "half" });
}
test("rejects malformed Content-Length before pulling the request stream", async () => {
  let pulls = 0;
  const stream = new ReadableStream({ pull(c) { pulls++; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  const result = await readBoundedJson(requestFromStream(stream, { "Content-Length": "2x" }), 16);
  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_content_length" });
  assert.equal(pulls, 0);
});
test("rejects declared oversized bodies before pulling and cancels the stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(17)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const result = await readBoundedJson(requestFromStream(stream, { "Content-Length": "17" }), 16);
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
});
test("enforces the streamed byte cap without Content-Length and cancels on overflow", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(17)); }, cancel() { cancelled = true; } });
  const result = await readBoundedJson(requestFromStream(stream), 16);
  assert.deepEqual(result, { ok: false, status: 413, error: "request_body_too_large" });
  assert.equal(cancelled, true);
});
test("accepts valid JSON exactly at the byte limit", async () => {
  const body = '{"ok":true}', size = new TextEncoder().encode(body).byteLength;
  const result = await readBoundedJson(new Request("https://state-store.test/", { method: "POST", headers: { "Content-Length": String(size) }, body }), size);
  assert.deepEqual(result, { ok: true, value: { ok: true } });
});
test("rejects declared and actual byte-length mismatch", async () => {
  const result = await readBoundedJson(new Request("https://state-store.test/", { method: "POST", headers: { "Content-Length": "5" }, body: "{}" }), 16);
  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_content_length" });
});
test("rejects invalid UTF-8 before JSON parsing", async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xc3,0x28])); c.close(); } });
  const result = await readBoundedJson(requestFromStream(stream), 16);
  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_json_encoding" });
});
test("rejects malformed JSON and invalid configured limits", async () => {
  const result = await readBoundedJson(new Request("https://state-store.test/", { method: "POST", body: "{invalid" }), 16);
  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_json" });
  await assert.rejects(() => readBoundedJson(new Request("https://state-store.test/"), 0), { name: "TypeError", message: "invalid_body_limit" });
});
test("readBoundedText validates strict UTF-8 and byte length", async () => {
  const body = '{"reason":"maintenance"}', size = new TextEncoder().encode(body).byteLength;
  assert.deepEqual(await readBoundedText(new Request("https://state-store.test/", { method: "POST", headers: { "Content-Length": String(size) }, body }), size), { ok: true, value: body });
  const invalid = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xc3,0x28])); c.close(); } });
  assert.equal((await readBoundedText(requestFromStream(invalid), 16)).error, "invalid_json_encoding");
});
