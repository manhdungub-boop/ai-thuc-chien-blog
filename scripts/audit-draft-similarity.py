#!/usr/bin/env python3
"""Internal 5-gram similarity screen for eight draft articles against the published library.
This is not an external plagiarism detector and cannot certify originality.
"""
from __future__ import annotations

import argparse
import itertools
import json
import re
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLISHED = ROOT / "site-snapshot" / "articles"
DRAFTS = ROOT / "docs" / "content-drafts"
EXPECTED_DRAFTS = [
    "kien-thuc-ai/bo-kiem-thu-20-cau-hoi-danh-gia-chat-luong-ai.md",
    "kien-thuc-ai/rag-kho-tri-thuc-co-trich-dan.md",
    "ai-tu-dong-hoa/agent-quyen-han-toi-thieu-human-approval.md",
    "ai-tu-dong-hoa/workflow-chong-loi-idempotency-dead-letter.md",
    "ai-kiem-tien/dong-goi-dich-vu-ai-cho-doanh-nghiep-nho.md",
    "ai-kiem-tien/phan-tich-hoa-von-va-tco-du-an-ai.md",
    "cong-cu-ai-mien-phi/chay-ai-local-ollama-open-webui.md",
    "cong-cu-ai-mien-phi/chuyen-giong-noi-local-whisper-cpp.md",
]


def words_from_text(source: str) -> list[str]:
    source = re.sub(r"https?://\S+", " ", source)
    return re.findall(r"[a-z0-9À-ỹ]+", source.lower())


def published_words(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    source = re.sub(r"<figure\b[\s\S]*?</figure>", " ", source, flags=re.I)
    source = re.sub(r"<script\b[\s\S]*?</script\s*[^>]*>|<style\b[\s\S]*?</style\s*[^>]*>", " ", source, flags=re.I)
    source = re.sub(r'<section\b[^>]*class=["\'][^"\']*(?:article-faq|related-articles|article-author-note)[^"\']*["\'][\s\S]*?</section>', " ", source, flags=re.I)
    source = re.sub(r"<h2\b[^>]*>\s*(?:Nguồn tham khảo chính thức|Tài liệu chính thức tham khảo|Nguồn tham khảo|Tài liệu tham khảo)\s*</h2>[\s\S]*$", " ", source, flags=re.I)
    first_rule = re.search(r"<hr\b[^>]*>", source, flags=re.I)
    if first_rule:
        source = source[first_rule.end():]
    return words_from_text(unescape(re.sub(r"<[^>]+>", " ", source)))


def draft_words(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    frontmatter = re.match(r"^---\s*\n[\s\S]*?\n---\s*\n", source)
    if frontmatter:
        source = source[frontmatter.end():]
    source = re.sub(r"^##\s+(?:Nguồn tham khảo|Nguồn chính thức)[\s\S]*$", " ", source, flags=re.I | re.M)
    source = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r" \1 ", source)
    source = re.sub(r"\[([^\]]+)\]\(https?://[^)]+\)", r" \1 ", source)
    source = re.sub(r"^\*[^\n]*(?:ghi rõ tác giả|vui lòng ghi rõ tác giả)[^\n]*$", " ", source, flags=re.I | re.M)
    source = re.sub(r"^\s*[-*_]{3,}\s*$", " ", source, flags=re.M)
    source = re.sub(r"^\s*\|?\s*:?-{3,}.*$", " ", source, flags=re.M)
    source = re.sub(r"[#>*_`~|]", " ", source)
    return words_from_text(source)


def shingles(tokens: list[str], size: int = 5) -> set[tuple[str, ...]]:
    return {tuple(tokens[i:i + size]) for i in range(max(0, len(tokens) - size + 1))}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=0.08)
    args = parser.parse_args()
    published_files = sorted(PUBLISHED.glob("*.html"))
    draft_files = [DRAFTS / relative for relative in EXPECTED_DRAFTS]
    missing = [str(path.relative_to(ROOT)) for path in draft_files if not path.is_file()]
    if missing or not published_files:
        print(json.dumps({"error": "missing source articles", "missing_drafts": missing, "published_articles": len(published_files)}, ensure_ascii=False))
        return 1

    corpus = []
    for path in published_files:
        tokens = published_words(path)
        corpus.append({"id": "published:" + path.stem, "kind": "published", "words": len(tokens), "shingles": shingles(tokens)})
    for path in draft_files:
        tokens = draft_words(path)
        corpus.append({"id": "draft:" + path.stem, "kind": "draft", "words": len(tokens), "shingles": shingles(tokens)})

    pairs = []
    for left, right in itertools.combinations(corpus, 2):
        if left["kind"] != "draft" and right["kind"] != "draft":
            continue
        union = left["shingles"] | right["shingles"]
        shared = left["shingles"] & right["shingles"]
        score = len(shared) / len(union) if union else 0.0
        pairs.append({
            "jaccard_5gram": round(score, 6),
            "article_a": left["id"],
            "article_b": right["id"],
            "shared_5grams": len(shared),
        })
    pairs.sort(key=lambda item: item["jaccard_5gram"], reverse=True)
    flagged = [pair for pair in pairs if pair["jaccard_5gram"] >= args.threshold]
    report = {
        "published_articles": len(published_files),
        "draft_articles": len(draft_files),
        "comparisons_including_drafts": len(pairs),
        "threshold": args.threshold,
        "max_similarity": pairs[0]["jaccard_5gram"] if pairs else 0.0,
        "pairs_at_or_above_threshold": flagged,
        "top_pairs": pairs[:10],
        "limitation": "Internal similarity screening only. It does not compare external websites, books, papers or other publishers and cannot certify absence of plagiarism.",
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if flagged else 0


if __name__ == "__main__":
    raise SystemExit(main())
