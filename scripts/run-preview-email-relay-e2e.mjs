import { randomBytes } from "node:crypto";

const previewUrl = new URL(process.env.PREVIEW_BASE_URL || "");
const runId = String(process.env.GITHUB_RUN_ID || "");
const recipient = String(process.env.TEST_EMAIL || "");

if (previewUrl.protocol !== "https:" ||
    previewUrl.hostname !== "ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev" ||
    previewUrl.pathname !== "/" || previewUrl.search || previewUrl.hash) {
  throw new Error("Refusing to send: PREVIEW_BASE_URL is not the approved isolated Preview origin.");
}
if (!/^\\d{1,20}$/.test(runId)) throw new Error("Missing or invalid GitHub run ID.");
if (!/^daingo11\\+ai-thuc-chien-\\d+@gmail\\.com$/i.test(recipient)) {
  throw new Error("Refusing to send: recipient is not the dedicated test inbox alias.");
}

const username = `preview_e2e_${runId.slice(-10)}`;
const password = randomBytes(32).toString("base64url");
const response = await fetch(new URL("/api/community/register", previewUrl), {
  method: "POST",
  headers: { "content-type": "application/json", "accept": "application/json" },
  body: JSON.stringify({
    username,
    displayName: "AI Thuc Chien Preview E2E",
    email: recipient,
    password
  }),
  redirect: "error",
  signal: AbortSignal.timeout(20000)
});

let payload = {};
try { payload = await response.json(); } catch { /* response is validated below */ }

if (response.status !== 201 || payload.verificationRequired !== true) {
  const safeCode = typeof payload.code === "string" ? payload.code : "NO_CODE";
  const safeError = typeof payload.error === "string" ? payload.error.slice(0, 180) : "Unexpected response";
  throw new Error(`Preview registration failed: HTTP ${response.status}; ${safeCode}; ${safeError}`);
}

console.log("PASS: Preview accepted the test registration and its synchronous email-relay call returned successfully.");
console.log("ACTION: Check the dedicated test inbox for the verification message; this workflow does not access the inbox.");
console.log("NOTE: The generated password is intentionally not logged or retained.");
