#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path

import runpy

published_words = runpy.run_path(str(Path(__file__).with_name('audit-draft-similarity.py')))['published_words']


class PublishedArticleExtractionTests(unittest.TestCase):
    def test_extracts_main_content_without_site_chrome_or_horizontal_rule(self):
        source = """<!doctype html>
        <header>Navigation Brand Header</header>
        <main id="main-content">
          <p>Unique article body tokens remain available here.</p>
        </main>
        <footer>Footer legal links and site chrome</footer>"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "article.html"
            path.write_text(source, encoding="utf-8")
            words = published_words(path)
        self.assertIn("unique", words)
        self.assertIn("article", words)
        self.assertNotIn("navigation", words)
        self.assertNotIn("brand", words)
        self.assertNotIn("footer", words)

    def test_rejects_unexpected_published_layout_instead_of_scoring_chrome(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "article.html"
            path.write_text("<header>Navigation</header><article>Body</article>", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "no #main-content region"):
                published_words(path)


if __name__ == "__main__":
    unittest.main()
