#!/usr/bin/env python3
"""Generate accessible, original inline SVG roadmaps from each article's section headings."""
from __future__ import annotations
import argparse
import html
import re
import textwrap
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
ARTICLES = ROOT / "site-snapshot" / "articles"
SKIP_HEADINGS = ("tài liệu chính thức tham khảo", "tài liệu tham khảo", "nguồn tham khảo", "câu hỏi thường gặp", "bài viết liên quan", "đọc tiếp", "tác giả", "kết luận", "lời kết", "thông tin thêm")
def plain(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()
def wrap_label(value: str) -> list[str]:
    value = re.sub(r"^\s*\d+[.)]\s*", "", value).strip()
    lines = textwrap.wrap(value, width=34, break_long_words=False, break_on_hyphens=False)
    if not lines: return ["Bước thực hành"]
    if len(lines) > 2:
        lines = lines[:2]
        lines[-1] = lines[-1].rstrip(".,;:") + "…"
    return lines
def labels_for(source: str) -> tuple[str, list[str]]:
    title_match = re.search(r"<h1\b[^>]*>(.*?)</h1>", source, re.I | re.S)
    title = plain(title_match.group(1)) if title_match else "Hướng dẫn thực hành AI"
    headings = [plain(x) for x in re.findall(r"<h2\b[^>]*>(.*?)</h2>", source, re.I | re.S)]
    headings = [x for x in headings if x and not any(k in x.lower() for k in SKIP_HEADINGS)]
    selected = headings[:3]
    fallback = ["Chuẩn bị đầu vào", "Thực hiện theo hướng dẫn", "Kiểm chứng và cải tiến"]
    while len(selected) < 3: selected.append(fallback[len(selected)])
    return title, selected
def figure_for(slug: str, title: str, labels: list[str]) -> str:
    safe_id = re.sub(r"[^a-z0-9-]+", "-", slug.lower()).strip("-")
    title_id, desc_id = f"article-diagram-title-{safe_id}", f"article-diagram-desc-{safe_id}"
    svg_title = html.escape("Sơ đồ thực hành: " + title, quote=True)
    svg_desc = html.escape("Ba bước chính trong bài viết: " + "; ".join(labels), quote=True)
    chunks = [
      f'<figure class="article-diagram" data-article-diagram="{safe_id}" role="group" aria-labelledby="{title_id}" style="max-width:620px;margin:30px auto;padding:18px;border:1px solid var(--line);border-radius:18px;background:#0b1424">',
      f'<svg viewBox="0 0 600 500" width="100%" height="auto" role="img" aria-labelledby="{title_id} {desc_id}" style="display:block;max-width:100%;height:auto">',
      f'<title id="{title_id}">{svg_title}</title>', f'<desc id="{desc_id}">{svg_desc}</desc>',
      '<defs><linearGradient id="diagram-accent-' + safe_id + '" x1="0" x2="1"><stop offset="0" stop-color="#55d6b5"/><stop offset="1" stop-color="#8ab4ff"/></linearGradient></defs>',
      '<text x="300" y="38" text-anchor="middle" fill="#73dfc2" font-size="16" font-weight="700" letter-spacing="2">LỘ TRÌNH THỰC HÀNH</text>'
    ]
    ys = [76, 222, 368]
    for index, (label, y) in enumerate(zip(labels, ys), start=1):
        lines = wrap_label(label)
        chunks.append(f'<rect x="58" y="{y}" width="484" height="94" rx="18" fill="#14243b" stroke="#36506f" stroke-width="2"/>')
        chunks.append(f'<circle cx="105" cy="{y+47}" r="22" fill="url(#diagram-accent-{safe_id})"/>')
        chunks.append(f'<text x="105" y="{y+54}" text-anchor="middle" fill="#081421" font-size="19" font-weight="800">{index}</text>')
        text_y = y + (51 if len(lines) == 1 else 39)
        tspans = [f'<tspan x="148" dy="{0 if i == 0 else 24}">{html.escape(line)}</tspan>' for i, line in enumerate(lines)]
        chunks.append(f'<text x="148" y="{text_y}" fill="#eef4ff" font-size="19" font-weight="600">{"".join(tspans)}</text>')
        if index < 3:
            chunks.append(f'<path d="M300 {y+96} V{ys[index]-8}" fill="none" stroke="#68d8bd" stroke-width="3" stroke-linecap="round"/>')
            chunks.append(f'<path d="M291 {ys[index]-18} L300 {ys[index]-7} L309 {ys[index]-18}" fill="none" stroke="#68d8bd" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>')
    chunks.extend(['</svg>', '<figcaption style="margin-top:10px;color:var(--muted);font-size:13px;line-height:1.6">Sơ đồ tóm tắt ba phần chính của bài viết. Đọc hướng dẫn chi tiết và kiểm chứng kết quả trước khi áp dụng vào dữ liệu thật.</figcaption>', '</figure>'])
    return "\n".join(chunks)
def transform(path: Path, check_only: bool) -> tuple[bool, str]:
    source = path.read_text(encoding="utf-8")
    slug = path.stem
    title, labels = labels_for(source)
    expected = figure_for(slug, title, labels)
    pattern = r'<figure\b[^>]*class=["\']article-diagram["\'][^>]*>[\s\S]*?</figure>'
    matches = list(re.finditer(pattern, source, re.I))
    if check_only:
        if len(matches) != 1: return False, f"{slug}: expected exactly one article diagram, found {len(matches)}"
        if matches[0].group(0) != expected: return False, f"{slug}: diagram is stale or does not match current section headings"
        return True, slug
    source = re.sub(pattern, "", source, flags=re.I)
    h1_end = re.search(r'</h1>', source, re.I)
    if not h1_end: return False, f"{slug}: missing H1; cannot place diagram safely"
    hr = re.search(r'<hr\b', source[h1_end.end():], re.I)
    insert_at = h1_end.end() + hr.start() if hr else h1_end.end()
    source = source[:insert_at] + "\n" + expected + "\n" + source[insert_at:]
    path.write_text(source, encoding="utf-8")
    return True, slug
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify diagrams without modifying files")
    args = parser.parse_args()
    files = sorted(ARTICLES.glob("*.html"))
    failures = []
    for path in files:
        ok, message = transform(path, args.check)
        if not ok: failures.append(message)
    if failures:
        print("ARTICLE DIAGRAM FAILURES:")
        print("\n".join(failures))
        return 1
    print(f"{'PASS' if args.check else 'GENERATED'} original accessible SVG diagrams for {len(files)} article pages.")
    return 0
if __name__ == "__main__": raise SystemExit(main())
