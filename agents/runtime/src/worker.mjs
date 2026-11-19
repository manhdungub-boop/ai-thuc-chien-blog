import { hasValidOperatorBearer } from "./operator-auth.mjs";

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: SECURITY_HEADERS,
  });
}

function isEnabled(value) {
  return value === "true";
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        return json({ ok: false, error: "method_not_allowed" }, 405);
      }

      return json({
        ok: true,
        service: "ai-thuc-chien-agent-runtime-preview",
        enabled: isEnabled(env.AGENT_ENABLED),
        paused: env.AGENT_PAUSED !== "false",
        execution: "not_implemented",
      });
    }

    if (url.pathname === "/run") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "method_not_allowed" }, 405);
      }

      if (!isEnabled(env.AGENT_ENABLED) || isEnabled(env.AGENT_PAUSED)) {
        return json({ ok: false, error: "agent_disabled_or_paused" }, 503);
      }

      if (!await hasValidOperatorBearer(request, env)) {
        return json({ ok: false, error: "operator_auth_required" }, 401);
      }

      return json({ ok: false, error: "execution_not_implemented" }, 501);
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
