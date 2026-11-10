#!/usr/bin/env python3
"""Measure near-duplicate text across article bodies; this is not an external plagiarism detector."""
from __future__ import annotations
import argparse
from html import unescape
import itertools
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTICLES = ROOT / "site-snapshot" / "articles"

def article_words(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    source = re.sub(r'<figure\b[\s\S]*?</figure>', ' ', source, flags=re.I)
    source = re.sub(r'<script\b[\s\S]*?</script\s*[^>]*>|<style\b[\s\S]*?</style\s*[^>]*>', ' ', source, flags=re.I)
    source = re.sub(r'<section\b[^>]*class=["\'][^"\']*(?:article-faq|related-articles|article-author-note)[^"\']*["\'][\s\S]*?</section>', ' ', source, flags=re.I)
    source = re.sub(r'<h2\b[^>]*>\s*(?:Nguồn tham khảo chính thức|Tài liệu chính thức tham khảo|Nguồn tham khảo|Tài liệu tham khảo)\s*</h2>[\s\S]*$', ' ', source, flags=re.I)
    source = re.sub(r'<p[^>]*>\s*<strong>Lưu ý:</strong>[\s\S]*?</p>', ' ', source, flags=re.I)
    source = re.sub(r'<p[^>]*>\s*Các liên kết là điểm bắt đầu[\s\S]*?</p>', ' ', source, flags=re.I)
    first_rule = re.search(r'<hr\b[^>]*>', source, flags=re.I)
    if first_rule:
        source = source[first_rule.end():]
    text = unescape(re.sub(r'<[^>]+>', ' ', source)).lower()
    text = re.sub(r'https?://\S+', ' ', text)
    return re.findall(r'[a-z0-9À-ỹ]+', text)

def shingles(words: list[str], size: int = 5) -> set[tuple[str, ...]]:
    return {tuple(words[i:i + size]) for i in range(max(0, len(words) - size + 1))}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--threshold', type=float, default=0.08, help='Fail if any pair has Jaccard similarity at or above this value')
    parser.add_argument('--report', type=Path, help='Optional JSON report path')
    args = parser.parse_args()
    files = sorted(ARTICLES.glob('*.html'))
    items = []
    for path in files:
        words = article_words(path)
        items.append({'slug': path.stem, 'word_count': len(words), 'shingles': shingles(words)})
    pairs = []
    for a, b in itertools.combinations(items, 2):
        union = a['shingles'] | b['shingles']
        intersection = a['shingles'] & b['shingles']
        score = len(intersection) / len(union) if union else 0.0
        pairs.append({'jaccard_5gram': round(score, 6), 'article_a': a['slug'], 'article_b': b['slug'], 'shared_5grams': len(intersection)})
    pairs.sort(key=lambda item: item['jaccard_5gram'], reverse=True)
    counts = sorted(item['word_count'] for item in items)
    report = {
        'articles': len(items),
        'method': '5-word shingle Jaccard similarity on article body text after removing site chrome, generated diagrams, FAQs, source lists, author notes and repeated disclaimers',
        'threshold': args.threshold,
        'word_count': {'min': counts[0] if counts else 0, 'median': counts[len(counts)//2] if counts else 0, 'max': counts[-1] if counts else 0},
        'max_similarity': pairs[0]['jaccard_5gram'] if pairs else 0,
        'pairs_at_or_above_threshold': [pair for pair in pairs if pair['jaccard_5gram'] >= args.threshold],
        'top_pairs': pairs[:10],
        'limitation': 'Internal similarity screening only. It does not compare against external websites, books, papers or other publishers and cannot certify absence of plagiarism.'
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not files:
        print('No article HTML files found.', flush=True)
        return 1
    return 1 if report['pairs_at_or_above_threshold'] else 0

if __name__ == '__main__':
    raise SystemExit(main())
