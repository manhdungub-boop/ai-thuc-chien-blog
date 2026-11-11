const previewUrl = new URL(process.env.PREVIEW_BASE_URL || "");
const runId = String(process.env.GITHUB_RUN_ID || "");
const recipient = String(process.env.TEST_EMAIL || "");

if (previewUrl.protocol !== "https:" ||
    previewUrl.hostname !== "ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev" ||
    previewUrl.pathname !== "/" || previewUrl.search || previewUrl.hash) {
  throw new Error("Refusing to send: PREVIEW_BASE_URL is not the approved isolated Preview origin.");
}
if (!/^\d{1,20}$/.test(runId)) throw new Error("Missing or invalid GitHub run ID.");
if (!/^daingo11\+ai-thuc-chien-\d+@gmail\.com$/i.test(recipient)) {
  throw new Error("Refusing to send: recipient is not the dedicated test inbox alias.");
}

const response = await fetch(new URL("/api/community/password-reset/request", previewUrl), {
  method: "POST",
  headers: { "content-type": "application/json", "accept": "application/json" },
  body: JSON.stringify({ email: recipient }),
  redirect: "error",
  signal: AbortSignal.timeout(20000)
});
let payload = {};
try { payload = await response.json(); } catch { /* validated below */ }
if (response.status !== 200 || payload.ok !== true) {
  const safeError = typeof payload.error === "string" ? payload.error.slice(0, 180) : "Unexpected response";
  throw new Error(\`Preview password-reset request failed: HTTP \${response.status}; \${safeError}\`);
}
console.log("PASS: Preview accepted the password-reset request with the expected privacy-preserving response.");
console.log("ACTION: Check the dedicated test inbox for the reset message; this workflow does not access the inbox.");
console.log("NOTE: The endpoint intentionally returns the same response for known and unknown email addresses; inbox delivery must be verified by the user.");
