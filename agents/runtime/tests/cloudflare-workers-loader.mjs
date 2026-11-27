// Node's built-in ESM loader does not implement Cloudflare's cloudflare:workers module.
// Unit tests use this minimal platform-base shim; Wrangler dry-run validates the real
// Cloudflare module binding and Worker bundle separately. This file is test-only.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
