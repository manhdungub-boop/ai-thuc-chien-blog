import assert from "node:assert/strict";
import { extractAttribute, hasExactUrlReference, hasUrlWithOrigin } from "./url-assertions.mjs";

const productionChat = "https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat";
assert.equal(hasExactUrlReference('fetch("https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat")', productionChat), true);
assert.equal(hasExactUrlReference('fetch("https://ai-thuc-chien-blog.manhdungub.workers.dev.evil.test/api/chat")', productionChat), false);
assert.equal(hasExactUrlReference('fetch("https://evil.test/https://ai-thuc-chien-blog.manhdungub.workers.dev/api/chat")', productionChat), false);
assert.equal(hasExactUrlReference('fetch("https://ai-thuc-chien-blog.manhdungub.workers.dev/other")', productionChat), false);
assert.equal(hasExactUrlReference('fetch("/api/chat")', productionChat), false);
assert.equal(hasUrlWithOrigin('{"url":"https://ai-thuc-chien-blog.manhdungub.workers.dev/articles/example"}', productionChat), true);
assert.equal(hasUrlWithOrigin('{"url":"https://evil.test/ai-thuc-chien-blog.manhdungub.workers.dev"}', productionChat), false);
assert.equal(extractAttribute('<link rel="canonical" href="https://preview.example.test/article">', "href"), "https://preview.example.test/article");
assert.equal(extractAttribute('<meta property="og:url" content=\'https://preview.example.test/article\'>', "content"), "https://preview.example.test/article");
console.log("PASS exact URL identity, origin matching, and quoted HTML attribute extraction");
