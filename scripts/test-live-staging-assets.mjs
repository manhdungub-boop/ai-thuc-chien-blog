function containsProductionChatEndpoint(source) {
  const productionOrigin = "https://ai-thuc-chien-blog.manhdungub.workers.dev";
  const urls = source.match(/https?:\/\/[^\s"'<>]+/g) || [];
  return urls.some((value) => {
    try {
      const parsed = new URL(value);
      return parsed.origin === productionOrigin && parsed.pathname === "/api/chat";
    } catch {
      return false;
    }
  });
}

const origin = process.env.STAGING_URL || "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const expected = [
  { path: "/script.js", markers: ["oauth/providers", "Tiếp tục với Google", "socialGoogleButton", "const apiUrl = '/api/chat';"] },
  { path: "/styles.css", markers: [".community-social-auth", ".community-social-button"] },
];

async function get(path) {
  const response = await fetch(new URL(path, origin), {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  return { response, body: await response.text() };
}

for (const check of expected) {
  const { body } = await get(check.path);
  for (const marker of check.markers) {
    if (!body.includes(marker)) {
      throw new Error(`${check.path}: thiếu dấu hiệu ${JSON.stringify(marker)}`);
    }
  }
  if (check.path === "/script.js" && containsProductionChatEndpoint(body)) {
    throw new Error("Staging script.js must not call the Production chat API.");
  }
  process.stdout.write(`PASS live asset ${check.path}\n`);
}

const { body: home } = await get("/");
for (const marker of ['id="community-auth-form"', 'src="script.js"', 'href="styles.css"']) {
  if (!home.includes(marker)) {
    throw new Error(`Homepage staging thiếu ${JSON.stringify(marker)}`);
  }
}
process.stdout.write("PASS staging homepage links the community form and current assets\n");
const { response: articleResponse, body: articleHtml } = await get("/articles/bat-dau-voi-ai");
if (!articleResponse.headers.get("x-robots-tag")?.match(/noindex/i)) {
  throw new Error("Staging article route must remain noindex.");
}
if (!articleHtml.includes("5 cách bắt đầu dùng AI")) {
  throw new Error("Staging article route did not serve the expected article content.");
}
if (containsProductionChatEndpoint(articleHtml)) {
  throw new Error("Staging article HTML must not embed the Production chat API URL.");
}
process.stdout.write("PASS staging article route is noindex and does not embed the Production chat API URL\n");


const { response: libraryResponse, body: libraryHtml } = await get("/thu-vien");
if (!libraryResponse.headers.get("x-robots-tag")?.match(/noindex/i)) {
  throw new Error("Staging library must remain noindex.");
}
if (!/Thư viện 69 bài thực hành/.test(libraryHtml)) {
  throw new Error("Staging library snapshot must serve the reviewed 69-article catalogue after release.");
}
process.stdout.write("PASS staging library serves the reviewed 69-article snapshot\\n");
const { body: providersBody } = await get("/api/community/oauth/providers");
let providers;
try {
  providers = JSON.parse(providersBody);
} catch {
  throw new Error("OAuth providers endpoint không trả JSON hợp lệ.");
}
if (providers.google !== true) {
  throw new Error("Google OAuth chưa sẵn sàng trên staging.");
}
if (providers.facebook !== false) {
  throw new Error("Facebook readiness không khớp trạng thái credentials đã biết.");
}
process.stdout.write("PASS staging Google provider readiness (google=true, facebook=false)\n");
