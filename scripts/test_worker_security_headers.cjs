import worker from "../worker.mjs";
const expected = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000",
};
for (const status of [200, 404]) {
  const body = status === 200 ? "site content" : "not found";
  const response = await worker.fetch(
    new Request("https://example.test/" + (status === 404 ? "missing" : "")),
    { ASSETS: { fetch: async () => new Response(body, {
      status, headers: { "Content-Type": "text/plain", "X-Test-Upstream": "preserved" },
    }) } },
  );
  if (response.status !== status) throw new Error("status changed: expected " + status + ", got " + response.status);
  if (await response.text() !== body) throw new Error("response body was not preserved");
  if (response.headers.get("X-Test-Upstream") !== "preserved") throw new Error("upstream header was not preserved");
  for (const [name, value] of Object.entries(expected)) {
    if (response.headers.get(name) !== value) throw new Error("missing or incorrect " + name + ": " + response.headers.get(name));
  }
}
console.log("WORKER SECURITY TEST PASS: all five headers are applied while 200/404 status, body, and upstream headers are preserved.");
