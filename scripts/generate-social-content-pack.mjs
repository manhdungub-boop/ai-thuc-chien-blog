#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
function field(xml, name) {
  const match = xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return match ? decodeXml(match[1]).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
}
function parseFeed(xml) {
  const channel = (xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i) || [])[1] || "";
  const base = new URL(field(channel, "link"));
  if (base.protocol !== "https:") throw new Error("RSS channel link must use HTTPS.");
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    const title = field(item, "title");
    const link = field(item, "link");
    const description = field(item, "description");
    const url = new URL(link);
    if (url.protocol !== "https:" || url.origin !== base.origin) throw new Error("RSS item URL is not on the official site origin.");
    if (!title || !description) throw new Error("RSS item is missing a title or description.");
    return { title, link: url.href, description, pubDate: field(item, "pubDate") };
  });
}
function clean(value) { return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim(); }
function escapeMarkdown(value) { return clean(value).replace(/([\\*_{}\[\]()#+.!|>])/g, "\\$1"); }
function makePack(items, generatedAt) {
  const lines = [
    "# Gói nội dung mạng xã hội — AI Thực Chiến", "",
    "- Tạo lúc: " + generatedAt,
    "- Nguồn: RSS chính thức của website",
    "- Phạm vi: " + items.length + " bài mới nhất trong RSS",
    "- Chỉ tạo bản nháp; không đăng bài, không gọi API mạng xã hội, không dùng khóa bí mật.",
    "- Nội dung bám theo tiêu đề/mô tả RSS; biên tập viên cần đọc bài gốc và duyệt video/hình ảnh trước khi đăng.", ""
  ];
  items.forEach((item, index) => {
    const title = escapeMarkdown(item.title);
    const summary = escapeMarkdown(item.description);
    lines.push("## " + (index + 1) + ". " + title, "", "**Bài gốc:** " + item.link, "", "**Tóm tắt theo RSS:** " + summary, "");
    lines.push("### TikTok — caption cho video ngắn", "");
    lines.push("Bạn đang cần tìm hiểu: " + clean(item.title).replace(/[|:–—].*$/, "").toLowerCase() + "?");
    lines.push(summary);
    lines.push("Xem hướng dẫn đầy đủ tại liên kết bài viết. Lưu lại nếu bạn muốn thực hành từng bước.");
    lines.push("#AIThucChien #DungAI #UngDungAI #TuDongHoa", "");
    lines.push("### YouTube Shorts — tiêu đề và mô tả", "");
    lines.push("**Tiêu đề đề xuất:** " + clean(item.title).replace(/\s*\|\s*AI Thực Chiến\s*$/i, "").slice(0, 95), "");
    lines.push("**Mô tả:**", "", summary, "", "Đọc hướng dẫn đầy đủ: " + item.link, "", "#AI #TuDongHoa #AIThucChien", "");
    lines.push("### Kiểm tra trước khi đăng", "");
    lines.push("- [ ] Đã đọc bài gốc và xác nhận mọi tuyên bố trong caption.");
    lines.push("- [ ] Video/hình ảnh do dự án sở hữu hoặc có giấy phép phù hợp.");
    lines.push("- [ ] Không lộ dữ liệu cá nhân, khóa API, thông tin tài khoản hoặc nội dung riêng tư.");
    lines.push("- [ ] Đã kiểm tra liên kết và CTA.");
    lines.push("- [ ] Người quản trị đã duyệt nội dung và thời điểm đăng.", "", "---", "");
  });
  return lines.join("\n");
}
function selfTest() {
  const sample = '<?xml version="1.0"?><rss><channel><link>https://example.org/</link><item><title>Thử nghiệm &amp; AI</title><link>https://example.org/articles/demo</link><description><![CDATA[Hướng dẫn an toàn &amp; thực tế.]]></description><pubDate>Sat, 15 Nov 2026 09:00:00 +0700</pubDate></item></channel></rss>';
  const items = parseFeed(sample);
  const output = makePack(items, "2026-11-15");
  if (items.length !== 1 || !output.includes("Thử nghiệm & AI") || !output.includes("Chỉ tạo bản nháp") || output.includes("undefined")) throw new Error("Self-test failed.");
  console.log("PASS: RSS parsing, escaping, draft generation and no-publish policy.");
}
if (process.argv.includes("--self-test")) selfTest();
else {
  const feedIndex = process.argv.indexOf("--feed");
  const outIndex = process.argv.indexOf("--out");
  const feedPath = feedIndex >= 0 ? process.argv[feedIndex + 1] : "feed.xml";
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : "reports/social/social-content-pack.md";
  const items = parseFeed(fs.readFileSync(feedPath, "utf8")).slice(0, 5);
  if (!items.length) throw new Error("No RSS items found.");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, makePack(items, new Date().toISOString()), "utf8");
  console.log("Social draft pack: " + items.length + " articles; no publishing or external API calls.");
}
