import assert from "node:assert/strict";
import routeWorker from "../recovery-snapshots/worker.mjs";
import emailVerificationWorker from "../recovery-snapshots/worker-email-verification-candidate.mjs";

async function call(worker, path, method = "GET", { assetStatus = 200, pagesProxy = false } = {}) {
  let assetRequestUrl = null;
  let upstreamRequestUrl = null;
  const env = {
    ASSETS: {
      async fetch(request) {
        assetRequestUrl = new URL(request.url);
        const body = assetStatus === 404
          ? "<!doctype html><html><body>Not found</body></html>"
          : "<!doctype html><html><body>test asset</body></html>";
        return new Response(body, {
          status: assetStatus,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    },
  };

  const originalFetch = globalThis.fetch;
  if (pagesProxy) {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      upstreamRequestUrl = url;
      const isMissingArticle = /^\/articles\/missing-article-route-test(?:\.html)?$/i.test(url.pathname);
      const status = isMissingArticle ? assetStatus : 200;
      const body = status === 404
        ? "<!doctype html><html><body>Not found</body></html>"
        : "<!doctype html><html><body>test Pages asset</body></html>";
      return new Response(body, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    };
  }

  let response;
  try {
    response = await worker.fetch(new Request("https://example.test" + path, { method }), env);
  } finally {
    if (pagesProxy) globalThis.fetch = originalFetch;
  }
  return { response, assetRequestUrl, upstreamRequestUrl };
}

async function testRoutes(worker, label, expectArticleAssetMapping, expectPostForwarding) {
  const login = await call(worker, "/login?from=menu&mode=register");
  assert.equal(login.response.status, 302, label + ": GET /login redirects");
  const loginLocation = new URL(login.response.headers.get("Location"));
  assert.equal(loginLocation.pathname, "/");
  assert.equal(loginLocation.searchParams.get("mode"), "login");
  assert.equal(loginLocation.searchParams.get("from"), "menu");
  assert.equal(loginLocation.hash, "#cong-dong");
  assert.equal(login.assetRequestUrl, null, label + ": auth redirect must not depend on ASSETS");

  const register = await call(worker, "/register?campaign=welcome");
  assert.equal(register.response.status, 302, label + ": GET /register redirects");
  const registerLocation = new URL(register.response.headers.get("Location"));
  assert.equal(registerLocation.pathname, "/");
  assert.equal(registerLocation.searchParams.get("mode"), "register");
  assert.equal(registerLocation.searchParams.get("campaign"), "welcome");
  assert.equal(registerLocation.hash, "#cong-dong");
  assert.equal(register.assetRequestUrl, null, label + ": auth redirect must not depend on ASSETS");

  const headLogin = await call(worker, "/login?from=menu", "HEAD");
  assert.equal(headLogin.response.status, 302, label + ": HEAD /login must use the auth redirect");
  const headLoginLocation = new URL(headLogin.response.headers.get("Location"));
  assert.equal(headLoginLocation.searchParams.get("mode"), "login");
  assert.equal(headLoginLocation.searchParams.get("from"), "menu");
  assert.equal(headLogin.assetRequestUrl, null, label + ": HEAD auth redirect must not depend on ASSETS");

  const headRegister = await call(worker, "/register?campaign=welcome", "HEAD");
  assert.equal(headRegister.response.status, 302, label + ": HEAD /register must use the auth redirect");
  const headRegisterLocation = new URL(headRegister.response.headers.get("Location"));
  assert.equal(headRegisterLocation.searchParams.get("mode"), "register");
  assert.equal(headRegisterLocation.searchParams.get("campaign"), "welcome");
  assert.equal(headRegister.assetRequestUrl, null, label + ": HEAD auth redirect must not depend on ASSETS");

  const article = await call(
    worker,
    "/articles/activepieces-trigger-va-action",
    "GET",
    { pagesProxy: !expectArticleAssetMapping },
  );
  assert.equal(article.response.status, 200, label + ": article route remains available");
  if (expectArticleAssetMapping) {
    assert.equal(article.assetRequestUrl.pathname, "/articles/activepieces-trigger-va-action.html");
  }

  const postLogin = await call(worker, "/login", "POST");
  assert.notEqual(postLogin.response.status, 301, label + ": POST /login must not be redirected");
  assert.notEqual(postLogin.response.status, 302, label + ": POST /login must not be redirected");
  if (expectPostForwarding) {
    assert.equal(postLogin.response.status, 200);
    assert.equal(postLogin.assetRequestUrl.pathname, "/login", label + ": POST must not be rewritten");
  } else {
    assert.equal(postLogin.response.status, 405, label + ": unsupported POST should be rejected without redirect");
    assert.equal(postLogin.assetRequestUrl, null, label + ": rejected POST must not reach static assets");
  }
}

await testRoutes(routeWorker, "route worker", true, true);
await testRoutes(emailVerificationWorker, "email-verification candidate", false, false);

async function testArticleHtmlCanonicalization() {
  const knownLegacy = await call(
    emailVerificationWorker,
    "/articles/activepieces-trigger-va-action.html?campaign=legacy",
    "GET",
    { pagesProxy: true },
  );
  assert.equal(knownLegacy.response.status, 301, "legacy .html article URL should redirect to canonical extensionless URL");
  const knownLocation = new URL(knownLegacy.response.headers.get("Location"));
  assert.equal(knownLocation.pathname, "/articles/activepieces-trigger-va-action");
  assert.equal(knownLocation.searchParams.get("campaign"), "legacy", "legacy article redirect must preserve query parameters");

  const missingLegacy = await call(
    emailVerificationWorker,
    "/articles/missing-article-route-test.html?from=legacy",
    "GET",
    { assetStatus: 404, pagesProxy: true },
  );
  assert.equal(missingLegacy.response.status, 301, "legacy .html URL redirects to extensionless form before checking content");
  const missingLocation = new URL(missingLegacy.response.headers.get("Location"));
  assert.equal(missingLocation.pathname, "/articles/missing-article-route-test");
  assert.equal(missingLocation.searchParams.get("from"), "legacy");

  const missingCanonical = await call(
    emailVerificationWorker,
    "/articles/missing-article-route-test?from=legacy",
    "GET",
    { assetStatus: 404, pagesProxy: true },
  );
  assert.equal(missingCanonical.response.status, 404, "unknown extensionless article must remain HTTP 404");
  assert.equal(missingCanonical.response.headers.get("Location"), null, "unknown article must not redirect to homepage");

  const missingHead = await call(
    emailVerificationWorker,
    "/articles/missing-article-route-test.html?from=head",
    "HEAD",
    { assetStatus: 404, pagesProxy: true },
  );
  assert.equal(missingHead.response.status, 301, "HEAD .html route uses same canonical redirect");
  const missingHeadTarget = await call(
    emailVerificationWorker,
    "/articles/missing-article-route-test?from=head",
    "HEAD",
    { assetStatus: 404, pagesProxy: true },
  );
  assert.equal(missingHeadTarget.response.status, 404, "HEAD to unknown canonical article must remain HTTP 404");
  assert.equal(missingHeadTarget.response.body, null, "HEAD 404 must not carry a body");
}

await testArticleHtmlCanonicalization();
console.log("Route resolution tests passed: auth redirects/query preservation, existing articles, missing article GET/HEAD 404s, legacy .html canonicalization, and no POST redirects.");
