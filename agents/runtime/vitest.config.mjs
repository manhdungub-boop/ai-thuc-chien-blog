import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" }
    })
  ],
  test: {
    include: ["tests/**/*.integration.test.mjs", "tests/ai-bank-discovery.test.mjs", "tests/research-discovery.test.mjs"],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false
  }
});
