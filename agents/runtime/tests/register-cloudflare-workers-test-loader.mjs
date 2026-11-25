import { register } from "node:module";

register(new URL("./cloudflare-workers-test-loader.mjs", import.meta.url), import.meta.url);
