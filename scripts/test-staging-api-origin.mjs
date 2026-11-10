import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const candidate = await readFile(new URL("../recovery-snapshots/worker-email-verification-candidate.mjs", import.meta.url), "utf8");
const entrypoint = await readFile(new URL("../staging-entrypoint.mjs", import.meta.url), "utf8");
const staticScript = await readFile(new URL("../site-snapshot/script.js", import.meta.url), "utf8");
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

assert.ok(candidate.includes("const apiUrl = '/api/chat';"), "The embedded fallback reader assistant must use the current origin for chat.");
assert.ok(!containsProductionChatEndpoint(candidate), "The staging candidate must not hard-code the Production chat endpoint.");
assert.ok(entrypoint.includes('pathname === "/api/chat"'), "The staging entrypoint must recognize the same-origin chat route.");
assert.ok(entrypoint.includes("worker.fetch(request, env, ctx)"), "The staging entrypoint must delegate chat requests to the staging auth worker.");
assert.ok(staticScript.includes("const apiUrl = '/api/chat';"), "The reviewed static frontend must use same-origin chat.");
assert.ok(!containsProductionChatEndpoint(staticScript), "The static frontend must not call the Production chat endpoint.");
console.log("PASS Staging chat API uses same-origin routing; no embedded Production chat endpoint remains.");
