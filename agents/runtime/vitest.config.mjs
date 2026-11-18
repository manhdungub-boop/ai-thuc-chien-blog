import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["tests/**/*.integration.test.mjs","tests/ai-bank-discovery.test.mjs","tests/research-discovery.test.mjs","tests/research-evidence.test.mjs","tests/research-evidence-assessment.test.mjs","tests/claim-evidence-ledger.test.mjs","tests/human-claim-review.test.mjs","tests/human-review-record-verifier.test.mjs","tests/google-oidc-reviewer-verifier.test.mjs","tests/google-reviewer-oauth.test.mjs","tests/reviewer-evidence-http-route.test.mjs","tests/article-quality-gate.test.mjs","tests/draft-artifact-store.integration.test.mjs"],
    testTimeout: 15000, hookTimeout: 15000, fileParallelism: false
  }
});
