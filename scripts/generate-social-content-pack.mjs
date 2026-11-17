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
function isVietnamese(value) { return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởởợúùủũụứừửữựýỳỷỹỵ]/i.test(value); }
function makePack(items, generatedAt) {
  const lines = [
    "# Bản nháp Facebook — AI Thực Chiến", "",
    "- Tạo lúc: " + generatedAt,
    "- Nguồn: RSS chính thức của website",
    "- Phạm vi: " + items.length + " bài mới nhất trong RSS",
    "- Kênh duy nhất: Facebook Page",
    "- Chỉ tạo bản nháp; không đăng bài, không gọi API mạng xã hội, không dùng khóa bí mật.",
    "- Bản nháp dựa trên RSS, chưa thay thế việc đọc và biên tập bài gốc.", ""
  ];
  items.forEach((item, index) => {
    const title = clean(item.title).replace(/\s*\|\s*AI Thực Chiến\s*$/i, "");
    const summary = clean(item.description);
    const vietnameseCopy = isVietnamese(title) && isVietnamese(summary);
    const languageNote = vietnameseCopy ? "" : "> **TẠM DỪNG — CHƯA ĐƯỢC ĐĂNG:** Tiêu đề hoặc tóm tắt chưa được xác nhận là tiếng Việt. Cần dịch, đọc bài gốc và được biên tập duyệt trước khi tạo nội dung đăng.\n\n";
    const channelTitle = vietnameseCopy ? title : "Nội dung đang chờ biên tập tiếng Việt";
    const channelSummary = vietnameseCopy ? summary : "Nội dung đang chờ biên dịch và xác minh từ bài gốc; không sử dụng tiêu đề hoặc tóm tắt nguồn này để đăng.";
    lines.push(
      "## " + (index + 1) + ". " + title, "",
      "**Bài gốc:** " + item.link, "",
      "**Nguồn RSS (chỉ để tham khảo, chưa phải nội dung đăng):** " + summary, "",
      "### Facebook Page — bản nháp", "",
      languageNote + "**" + channelTitle + "**", "",
      channelSummary, "",
      "Bài viết hướng dẫn đầy đủ: " + item.link, "",
      "Bạn đang áp dụng cách này trong công việc như thế nào? Chia sẻ kinh nghiệm hoặc câu hỏi ở phần bình luận nhé.", "",
      "#AIThucChien #DungAI #UngDungAI #TuDongHoa", "",
      "### Kiểm tra trước khi đăng", "",
      "- [ ] Đã đọc bài gốc và xác nhận mọi tuyên bố.",
      "- [ ] Đã biên tập tiếng Việt tự nhiên, không chỉ sao chép RSS.",
      "- [ ] Hình ảnh có quyền sử dụng phù hợp.",
      "- [ ] Không lộ dữ liệu cá nhân, khóa API hoặc thông tin riêng tư.",
      "- [ ] Đã kiểm tra liên kết, CTA và được người quản trị duyệt.", "",
      "---", ""
    );
  });
  return lines.join("\n");
}
function selfTest() {
  const sample = '<?xml version="1.0"?><rss><channel><link>https://example.org/</link><item><title>Hướng dẫn AI an toàn</title><link>https://example.org/articles/demo</link><description><![CDATA[Cách kiểm tra dữ liệu trước khi tự động hóa.]]></description></item></channel></rss>';
  const items = parseFeed(sample);
  const output = makePack(items, "2026-11-18");
  if (items.length !== 1 || !output.includes("Hướng dẫn AI an toàn") || !output.includes("### Facebook Page — bản nháp") || !output.includes("Đã biên tập")) {
    throw new Error("RSS parsing or Facebook draft self-test failed.");
  }
  if (/TikTok|YouTube Shorts/i.test(output)) throw new Error("Non-Facebook destination leaked into the draft pack.");
  const englishPack = makePack([{
    title: "Practical AI guide",
    link: "https://example.org/articles/english",
    description: "A practical guide to safe AI automation."
  }], "2026-11-18");
  if (!englishPack.includes("TẠM DỪNG — CHƯA ĐƯỢC ĐĂNG") || !englishPack.includes("Nội dung đang chờ biên dịch")) {
    throw new Error("Non-Vietnamese content must be blocked pending translation and source review.");
  }
  if (englishPack.includes("**Practical AI guide**")) throw new Error("Unverified English title leaked into publish-ready copy.");
  const asciiPack = makePack([{
    title: "Huong dan su dung AI an toan",
    link: "https://example.org/articles/ascii",
    description: "Huong dan kiem tra du lieu truoc khi tu dong hoa."
  }], "2026-11-18");
  if (!asciiPack.includes("TẠM DỪNG — CHƯA ĐƯỢC ĐĂNG")) throw new Error("Undiacritized text must be held for manual language review.");
  const expectFailure = (xml, label) => {
    let failed = false;
    try { parseFeed(xml); } catch { failed = true; }
    if (!failed) throw new Error("Unsafe or malformed RSS input was accepted: " + label);
  };
  expectFailure('<?xml version="1.0"?><rss><channel><link>https://example.org/</link><item><title>External</title><link>https://attacker.example/post</link><description>Text</description></item></channel></rss>', "cross-origin item URL");
  expectFailure('<?xml version="1.0"?><rss><channel><link>http://example.org/</link><item><title>HTTP</title><link>http://example.org/post</link><description>Text</description></item></channel></rss>', "non-HTTPS feed origin");
  expectFailure('<?xml version="1.0"?><rss><channel><link>https://example.org/</link><item><title>Missing description</title><link>https://example.org/post</link></item></channel></rss>', "missing description");
  expectFailure('<?xml version="1.0"?><rss><channel><link>https://example.org/</link><item><link>https://example.org/post</link><description>Text</description></item></channel></rss>', "missing title");
  console.log("PASS: Facebook-only RSS draft, Vietnamese content gate, safe URL checks and no-publish policy.");
}
if (process.argv.includes("--self-test")) selfTest();
else {
  const feedIndex = process.argv.indexOf("--feed");
  const outIndex = process.argv.indexOf("--out");
  const feedPath = feedIndex >= 0 ? process.argv[feedIndex + 1] : "feed.xml";
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : "reports/social/facebook-content-draft.md";
  const items = parseFeed(fs.readFileSync(feedPath, "utf8")).slice(0, 5);
  if (!items.length) throw new Error("No RSS items found.");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, makePack(items, new Date().toISOString()), "utf8");
  console.log("Facebook draft pack: " + items.length + " articles; no publishing or external API calls.");
}
