#!/usr/bin/env python3
"""No-side-effect content checks for article pull requests."""
import html, json, os, re, subprocess, sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
BASE_URL = "https://ai-thuc-chien-blog.manhdungub.workers.dev"
class Audit(HTMLParser):
    def __init__(self):
        super().__init__(); self.title=False; self.h1=0; self.hrefs=[]; self.visible=[]; self.head=False; self.in_title=False; self.script=False; self.style=False
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='head': self.head=True
        if tag=='title': self.in_title=True
        if tag=='h1': self.h1+=1
        if tag=='a' and a.get('href'): self.hrefs.append(a['href'])
        if tag=='script': self.script=True
        if tag=='style': self.style=True
    def handle_endtag(self, tag):
        if tag=='head': self.head=False
        if tag=='title': self.in_title=False
        if tag=='script': self.script=False
        if tag=='style': self.style=False
    def handle_data(self, data):
        if self.in_title and data.strip(): self.title=True
        if not self.head and not self.script and not self.style: self.visible.append(data)
def fail(msg): print('FAIL:',msg); sys.exit(1)
base_ref=os.environ.get('BASE_REF','main')
subprocess.run(['git','fetch','origin',base_ref,'--depth=1'],check=True)
changed=subprocess.check_output(['git','diff','--name-only',f'origin/{base_ref}...HEAD'],text=True).splitlines()
articles=[p for p in changed if p.startswith('articles/') and p.endswith('.html')]
print(f'Changed article files: {len(articles)}')
if not articles: print('No changed article HTML; skip content-specific checks.'); sys.exit(0)
sitemap=Path('sitemap.xml').read_text(encoding='utf-8'); feed=Path('feed.xml').read_text(encoding='utf-8')
for name in articles:
    path=Path(name); source=path.read_text(encoding='utf-8'); a=Audit(); a.feed(source)
    if not a.title: fail(f'{name}: missing title')
    if a.h1!=1: fail(f'{name}: expected exactly one H1, got {a.h1}')
    desc=re.findall(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']+)',source,re.I)
    if len(desc)!=1 or not desc[0].strip(): fail(f'{name}: expected exactly one meta description')
    canonical=re.findall(r'<link\s+rel=["\']canonical["\']\s+href=["\']([^"\']+)',source,re.I)
    if len(canonical)!=1 or not canonical[0].startswith(BASE_URL+'/articles/'): fail(f'{name}: canonical must use the production article URL')
    blocks=re.findall(r'<script\s+type=["\']application/ld\+json["\']\s*>(.*?)</script>',source,re.I|re.S)
    if not blocks: fail(f'{name}: missing JSON-LD')
    for block in blocks:
        try: json.loads(block)
        except json.JSONDecodeError as e: fail(f'{name}: invalid JSON-LD: {e}')
    visible=html.unescape(' '.join(a.visible))
    if 'ai-thuc-chien-blog.manhdungub.workers.dev/articles/' in visible: fail(f'{name}: production URL leaked into visible copy')
    external=[u for u in a.hrefs if urlsplit(u).scheme=='https' and urlsplit(u).netloc and not urlsplit(u).netloc.endswith(('workers.dev','pages.dev')) and urlsplit(u).netloc!='github.io']
    if not external: fail(f'{name}: add at least one relevant HTTPS source link')
    slug=path.stem
    if not re.search(r'<loc>[^<]*'+re.escape(slug)+r'[^<]*</loc>',sitemap): fail(f'{name}: missing from sitemap.xml')
    if not re.search(r'<link>[^<]*'+re.escape(slug)+r'[^<]*</link>',feed): fail(f'{name}: missing from feed.xml')
    print(f'PASS: {name} — metadata, H1, canonical, JSON-LD, source, visible copy, sitemap and RSS')
print('CONTENT QUALITY CHECKS PASSED; this workflow does not approve or publish content.')
