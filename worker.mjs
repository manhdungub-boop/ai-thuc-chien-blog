const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=()",
});

function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000");
  } else {
    headers.delete("Strict-Transport-Security");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function resolveAssetRequest(request) {
  const url = new URL(request.url);
  // With html_handling="none", explicitly map the site root to its index file.
  // Canonical article URLs are extensionless while the deployed files are .html.
  // Rewrite only safe GET/HEAD requests; leave mutations and all other paths untouched.
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
    url.pathname = "/index.html";
    return new Request(url, request);
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    /^\/articles\/[a-z0-9-]+$/i.test(url.pathname)
  ) {
    url.pathname += ".html";
    return new Request(url, request);
  }
  return request;
}

export default {
  async fetch(request, env) {
    try {
      return withSecurityHeaders(
        await env.ASSETS.fetch(resolveAssetRequest(request)),
        request,
      );
    } catch (_error) {
      const failure = new Response("Internal Server Error\n", {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
      return withSecurityHeaders(failure, request);
    }
  },
};
