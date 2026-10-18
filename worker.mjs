const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000",
});

function applySecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name !== "Strict-Transport-Security" || new URL(request.url).protocol === "https:") {
      headers.set(name, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function internalError(request) {
  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name !== "Strict-Transport-Security" || new URL(request.url).protocol === "https:") {
      headers.set(name, value);
    }
  }
  return new Response("Internal Server Error", { status: 500, headers });
}

export default {
  async fetch(request, env) {
    try {
      if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
        throw new Error("Static asset binding is unavailable");
      }
      const assetResponse = await env.ASSETS.fetch(request);
      return applySecurityHeaders(assetResponse, request);
    } catch (_error) {
      // Do not return internal error details to visitors. Avoid caching transient failures.
      return internalError(request);
    }
  },
};
