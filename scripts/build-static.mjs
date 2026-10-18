import { cp, mkdir, rm } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const staticFiles = ["index.html","ve-chung-toi.html","feed.xml","styles.css","script.js","robots.txt","sitemap.xml","favicon.svg","404.html","google4e45ddcf8facb122.html","_headers"];
await rm(dist, { recursive: true, force: true });
await mkdir(new URL("articles/", dist), { recursive: true });
for (const file of staticFiles) await cp(new URL(file, root), new URL(file, dist));
await cp(new URL("articles/", root), new URL("articles/", dist), { recursive: true });
console.log("Build PASS: copied public website files and articles into dist/.");
