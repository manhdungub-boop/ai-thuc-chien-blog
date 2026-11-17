#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

const OFFSET_MINUTES = 7 * 60; // Asia/Ho_Chi_Minh (UTC+07:00)
// Read-only Metricool brand inspection on 2026-11-17 confirmed the project's
// TikTok handle. Keep this as a simulation allowlist; it does not grant publish permission.
const PLATFORMS = ["tiktok"];
const MIN_PLATFORM_GAP_HOURS = 24;
const MAX_PLATFORM_GAP_HOURS = 72;
const MIN_GLOBAL_GAP_HOURS = 3;
const WINDOW_START_MINUTE = 8 * 60;
const WINDOW_END_MINUTE = 21 * 60;

function makeRandom(seed) {
  if (!seed) {
    let pool = randomBytes(4).readUInt32BE(0) || 1;
    return () => {
      pool = (pool + 0x6D2B79F5) >>> 0;
      let t = pool;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = createHash("sha256").update(String(seed)).digest();
  let state = hash.readUInt32BE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function localParts(timestamp) {
  const d = new Date(timestamp + OFFSET_MINUTES * 60_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}
function localLabel(timestamp) {
  const d = new Date(timestamp + OFFSET_MINUTES * 60_000);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return date + " " + time + " (Asia/Ho_Chi_Minh)";
}
function candidatesFor(startMs, days) {
  const first = localParts(startMs);
  const startLocalMinute = new Date(startMs + OFFSET_MINUTES * 60_000).getUTCHours() * 60
    + new Date(startMs + OFFSET_MINUTES * 60_000).getUTCMinutes();
  const candidates = [];
  for (let day = 0; day < days; day++) {
    const date = new Date(Date.UTC(first.year, first.month, first.day + day));
    for (let minute = WINDOW_START_MINUTE; minute <= WINDOW_END_MINUTE; minute += 15) {
      if (day === 0 && minute < startLocalMinute + 30) continue;
      const timestamp = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, minute)
        - OFFSET_MINUTES * 60_000;
      if (timestamp > startMs + 15 * 60_000) candidates.push(timestamp);
    }
  }
  return candidates;
}
function createSchedule({ startMs, days = 14, seed, platforms = PLATFORMS }) {
  if (!Number.isFinite(startMs) || !Number.isInteger(days) || days < 7 || days > 30) {
    throw new Error("startMs must be valid and days must be an integer from 7 to 30.");
  }
  const random = makeRandom(seed);
  const allSlots = [];
  for (const platform of platforms) {
    allSlots.push({ platform, sequence: 1 }, { platform, sequence: 2 });
  }
  const order = shuffle(allSlots, random);
  const candidates = shuffle(candidatesFor(startMs, days), random);
  const chosen = [];
  const byPlatform = new Map(platforms.map(name => [name, []]));
  let attempts = 0;
  function place(index) {
    if (index === order.length) return true;
    const slot = order[index];
    for (const timestamp of candidates) {
      attempts++;
      if (attempts > 250000) return false;
      if (chosen.some(item => Math.abs(item.timestamp - timestamp) < MIN_GLOBAL_GAP_HOURS * 3600_000)) continue;
      const prior = byPlatform.get(slot.platform);
      if (prior.length) {
        const gapHours = Math.abs(timestamp - prior[0].timestamp) / 3600_000;
        if (gapHours < MIN_PLATFORM_GAP_HOURS || gapHours > MAX_PLATFORM_GAP_HOURS) continue;
      }
      const event = { platform: slot.platform, sequence: slot.sequence, timestamp };
      chosen.push(event);
      priorPush(prior, timestamp);
      if (place(index + 1)) return true;
      chosen.pop();
      prior.pop();
    }
    return false;
  }
  function priorPush(list, value) { list.push({ timestamp: value }); }
  if (!place(0)) throw new Error("Could not find a safe randomized plan in this window; skip scheduling rather than forcing a post.");
  return chosen.sort((a, b) => a.timestamp - b.timestamp).map((item, index) => ({
    order: index + 1,
    platform: item.platform,
    local_time: localLabel(item.timestamp),
    timestamp: new Date(item.timestamp).toISOString()
  }));
}
function renderMarkdown(schedule, { days, generatedAt, seedLabel }) {
  const lines = [
    "# Mô phỏng lịch xuất bản ngẫu nhiên — AI Thực Chiến", "",
    "> **CHỈ LÀ MÔ PHỎNG — KHÔNG ĐĂNG BÀI.** Đây là các khung giờ đề xuất để kiểm tra thuật toán; không có API mạng xã hội, tài khoản, token hay thao tác xuất bản nào được gọi.", "",
    "- Tạo lúc (UTC): " + generatedAt,
    "- Cửa sổ mô phỏng: " + days + " ngày",
    "- Múi giờ: Asia/Ho_Chi_Minh (UTC+07:00)",
    "- Nguồn ngẫu nhiên: " + seedLabel,
    "- Khung giờ đủ điều kiện: 08:00–21:00, chỉ là giới hạn; giờ thực tế được xáo trộn.",
    "- Giới hạn: 2 khung giờ cho TikTok trong mô phỏng; cách nhau 24–72 giờ.",
    "- Tài khoản TikTok dự án `@ai_thuc_chien_dungai` đã được xác nhận có kết nối trong Metricool bằng truy vấn chỉ đọc ngày 17/11/2026.",
    "- Chỉ đưa TikTok vào mô phỏng. Facebook chưa được xác minh là kết nối của brand này; YouTube đang kết nối là kênh “Tín Hiệu Cơ Thể”, không phải kênh AI Thực Chiến nên bị loại trừ.",
    "- Mô phỏng không xác nhận quyền đăng, hạn mức còn lại hoặc trạng thái xuất bản thực tế; phải kiểm tra lại trước khi tạo lịch công khai.",
    "- Video/Short có giọng đọc vẫn tạm dừng. Mô phỏng chỉ định hướng cho nội dung ảnh tĩnh; ảnh TikTok phải là JPEG hoặc WebP.",
    "- Không bảo đảm đây là giờ tốt nhất; cần dữ liệu phân tích tài khoản thật đã xác minh trước khi tối ưu.", "",
    "| Thứ tự | Nền tảng | Thời điểm đề xuất |",
    "|---:|---|---|"
  ];
  if (schedule.length) {
    for (const item of schedule) lines.push("| " + item.order + " | " + item.platform + " | " + item.local_time + " |");
  } else {
    lines.push("| — | Chưa có tài khoản xác minh | Không tạo lịch |");
  }
  lines.push("", "## Kiểm soát", "",
    "- [x] Chỉ mô phỏng 2 khung giờ TikTok cho tài khoản dự án đã xác minh kết nối.",
    "- [x] Không đưa Facebook hoặc YouTube vào lịch.",
    "- [x] Thuật toán khoảng cách ngẫu nhiên được kiểm thử riêng bằng nền tảng giả lập `TEST`.",
    "- [x] Không gọi API, không tạo lịch Planner, không đăng công khai.",
    "- [ ] Chưa xác minh quyền đăng và hạn mức tháng còn lại — không được kích hoạt xuất bản.",
    "- [ ] Chưa có dữ liệu phân tích người xem đủ để kết luận khung giờ tối ưu.", "");
  return lines.join("\n");
}
function selfTest() {
  const startMs = Date.parse("2026-11-17T00:00:00.000Z");
  const first = createSchedule({ startMs, days: 14, seed: "repeatable-test", platforms: ["TEST"] });
  const second = createSchedule({ startMs, days: 14, seed: "repeatable-test", platforms: ["TEST"] });
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("Seeded simulation is not reproducible.");
  if (first.length !== 2) throw new Error("Expected exactly two synthetic TEST slots for the spacing regression test.");
  const rows = first.filter(item => item.platform === "TEST");
  if (rows.length !== 2) throw new Error("Incorrect slot count for TEST");
  const gap = (Date.parse(rows[1].timestamp) - Date.parse(rows[0].timestamp)) / 3600000;
  if (gap < MIN_PLATFORM_GAP_HOURS || gap > MAX_PLATFORM_GAP_HOURS) throw new Error("Platform gap is outside 24–72 hours.");
  for (let i = 0; i < first.length; i++) {
    const d = new Date(Date.parse(first[i].timestamp) + OFFSET_MINUTES * 60000);
    const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (minute < WINDOW_START_MINUTE || minute > WINDOW_END_MINUTE) throw new Error("Slot outside allowed local-time window.");
    for (let j = i + 1; j < first.length; j++) {
      const gapHours = Math.abs(Date.parse(first[i].timestamp) - Date.parse(first[j].timestamp)) / 3600000;
      if (gapHours < MIN_GLOBAL_GAP_HOURS) throw new Error("Cross-platform spacing is too short.");
    }
  }
  const alternate = createSchedule({ startMs, days: 14, seed: "different-seed", platforms: ["TEST"] });
  if (JSON.stringify(first) === JSON.stringify(alternate)) throw new Error("Different seeds produced the same schedule.");
  const projectSlots = createSchedule({ startMs, days: 14, seed: "project-test", platforms: PLATFORMS });
  if (projectSlots.length !== 2 || projectSlots.some(item => item.platform !== "tiktok")) {
    throw new Error("The verified project plan must contain exactly two TikTok simulation slots.");
  }
  const noAccount = createSchedule({ startMs, days: 14, seed: "no-account", platforms: [] });
  if (noAccount.length !== 0) throw new Error("No verified social account must produce zero schedule slots.");
  const rendered = renderMarkdown(projectSlots, { days: 14, generatedAt: "2026-11-17T00:00:00.000Z", seedLabel: "test" });
  if (!rendered.includes("`@ai_thuc_chien_dungai`") || !rendered.includes("Chỉ đưa TikTok vào mô phỏng")) {
    throw new Error("Verified TikTok destination evidence is missing from the simulation report.");
  }
  if (rendered.includes("Facebook |") || rendered.includes("YouTube |") || !rendered.includes("KHÔNG ĐĂNG BÀI")) {
    throw new Error("An excluded platform or publishing action leaked into the simulation.");
  }
  console.log("PASS: two TikTok-only project simulation slots, synthetic spacing regression, seeded reproducibility, zero slots without a verified account, no-publish boundary.");
}
if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const daysArg = process.argv.indexOf("--days");
  const seedArg = process.argv.indexOf("--seed");
  const outArg = process.argv.indexOf("--out");
  const days = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 14;
  const seed = seedArg >= 0 ? process.argv[seedArg + 1] : "";
  const out = outArg >= 0 ? process.argv[outArg + 1] : "reports/social/social-publishing-schedule-simulation.md";
  const startMs = Date.now();
  const schedule = createSchedule({ startMs, days, seed, platforms: PLATFORMS });
  const markdown = renderMarkdown(schedule, {
    days,
    generatedAt: new Date().toISOString(),
    seedLabel: seed ? "seed kiểm thử được cung cấp" : "nguồn ngẫu nhiên mới cho mỗi lần chạy"
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, markdown, "utf8");
  console.log("Created simulation only: " + schedule.length + " randomized slots; no publishing or external API calls.");
}
