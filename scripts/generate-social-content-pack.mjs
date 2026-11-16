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
    return { title, link: url.href, description };
  });
}
function clean(value) { return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim(); }
function isVietnamese(value) { return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(value); }
function makePack(items, generatedAt) {
  const lines = [
    "# Gói nội dung mạng xã hội — AI Thực Chiến", "",
    "- Tạo lúc: " + generatedAt,
    "- Nguồn: RSS chính thức của website",
    "- Phạm vi: " + items.length + " bài mới nhất trong RSS",
    "- Chỉ tạo bản nháp; không đăng bài, không gọi API mạng xã hội, không dùng khóa bí mật.",
    "- Bản nháp dựa trên RSS, chưa thay thế việc đọc và biên tập bài gốc.", ""
  ];
  items.forEach((item, index) => {
    const title = clean(item.title);
    const summary = clean(item.description);
    const shortTitle = title.replace(/\s*\|\s*AI Thực Chiến\s*$/i, "");
    const languageNote = isVietnamese(summary) ? "" : "> **Cần biên tập:** Tóm tắt RSS hiện không phải tiếng Việt; cần dịch và đối chiếu bài gốc trước khi đăng.\n\n";
    lines.push("## " + (index + 1) + ". " + title, "", "**Bài gốc:** " + item.link, "", "**Tóm tắt RSS (nguyên văn):** " + summary, "");
    lines.push("### TikTok — bản nháp", "", languageNote + "Tìm hiểu cách " + shortTitle.toLowerCase() + ". " + summary, "", "Đọc hướng dẫn đầy đủ tại: " + item.link, "#AIThucChien #DungAI #UngDungAI #TuDongHoa", "");
    lines.push("### YouTube Shorts — bản nháp", "", "**Tiêu đề:** " + shortTitle.slice(0, 95), "", "**Mô tả:**", "", languageNote + summary, "", "Đọc bài đầy đủ: " + item.link, "#AI #TuDongHoa #AIThucChien", "");
    lines.push("### Facebook Page — bản nháp", "", languageNote + "**" + shortTitle + "**", "", summary, "", "Bài viết hướng dẫn đầy đủ: " + item.link, "", "Bạn đang áp dụng cách này trong công việc như thế nào? Chia sẻ kinh nghiệm hoặc câu hỏi ở phần bình luận nhé.", "", "#AIThucChien #DungAI #UngDungAI #TuDongHoa", "");
    lines.push("### Kiểm tra trước khi đăng", "", "- [ ] Đã đọc bài gốc và xác nhận mọi tuyên bố.", "- [ ] Đã biên tập tiếng Việt tự nhiên, không chỉ sao chép RSS.", "- [ ] Video/hình ảnh có quyền sử dụng phù hợp.", "- [ ] Không lộ dữ liệu cá nhân, khóa API hoặc thông tin riêng tư.", "- [ ] Đã kiểm tra liên kết, CTA và được người quản trị duyệt.", "", "---", "");
  });
  return lines.join("\n");
}
function selfTest() {
  const sample = '<?xml version="1.0"?><rss><channel><link>https://example.org/</link><item><title>Thử nghiệm &amp; AI</title><link>https://example.org/articles/demo</link><description><![CDATA[Hướng dẫn an toàn &amp; thực tế.]]></description></item></channel></rss>';
  const items = parseFeed(sample);
  const output = makePack(items, "2026-11-15");
  const channels = ["### TikTok — bản nháp", "### YouTube Shorts — bản nháp", "### Facebook Page — bản nháp"];
  if (items.length !== 1 || !output.includes("Thử nghiệm & AI") || output.includes("\\.") || !output.includes("Đã biên tập")) throw new Error("RSS parsing or baseline draft self-test failed.");
  if (channels.some(channel => !output.includes(channel))) throw new Error("A required social destination draft is missing.");
  if (output.includes("Cần biên tập")) throw new Error("Vietnamese RSS summary was incorrectly flagged for translation.");

  const englishPack = makePack([{
    title: "Practical AI guide",
    link: "https://example.org/articles/english",
    description: "A practical guide to safe AI automation."
  }], "2026-11-15");
  if (!englishPack.includes("Cần biên tập")) throw new Error("Non-Vietnamese RSS summary must be flagged for translation and source review.");
  if (!englishPack.includes("### Facebook Page — bản nháp")) throw new Error("Facebook draft missing from non-Vietnamese pack.");
  console.log("PASS: RSS parsing, all three destination drafts, Vietnamese/translation gate and no-publish policy.");
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
