# Deployment and maintenance

## Public URLs

- Primary website: https://ai-thuc-chien-blog.manhdungub.workers.dev/
- Cloudflare Pages: https://ai-thuc-chien-blog.pages.dev/
- GitHub Pages backup: https://manhdungub-boop.github.io/ai-thuc-chien-blog/
- RSS feed: https://ai-thuc-chien-blog.manhdungub.workers.dev/feed.xml
- Repository: https://github.com/manhdungub-boop/ai-thuc-chien-blog

## Automatic deployment

The workflow .github/workflows/deploy-cloudflare-pages.yml runs for each push to main, and can also be started manually from GitHub Actions. It stages only the static site files into dist/ and uses Wrangler to deploy the Cloudflare Pages Direct Upload project.

The GitHub Actions repository secret CLOUDFLARE_API_TOKEN is required. It is scoped to Pages Read/Write for the intended Cloudflare account and expires on 18 April 2027. Rotate it before expiry and update the GitHub repository secret; never commit credentials into the repository.

GitHub Pages also builds from main. Cloudflare Workers has its own build integration. Keep these endpoints intact unless a deliberate migration has been tested.

## Automatic health checks

The workflow .github/workflows/health-check.yml runs after a successful Cloudflare Pages deploy, every Monday at 02:00 UTC (09:00 Vietnam time), and on manual request. It validates page metadata, JSON-LD, sitemap uniqueness, RSS XML/items, public HTTP routes, and byte-for-byte matching for the intended static files on all three hosting endpoints.

Open the latest runs:
- https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/workflows/deploy-cloudflare-pages.yml
- https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/workflows/health-check.yml

## Current content inventory

- index.html — homepage and four-article library.
- ve-chung-toi.html — editorial transparency, content principles and issue-reporting path.
- articles/bat-dau-voi-ai.html — practical introduction to AI at work.
- articles/quy-trinh-ai-co-kiem-duyet.html — human review gates for automation.
- articles/ban-do-cong-cu-blog-ai.html — low-cost tool map for an AI blog.
- articles/kiem-chung-noi-dung-ai.html — checklist for verifying AI-assisted content.
- feed.xml — RSS 2.0 feed for the four articles.
- sitemap.xml and robots.txt — crawler discovery.
- styles.css, script.js, favicon.svg, 404.html — presentation, navigation, site icon and error page.

## Safe operating rules

- Do not delete or overwrite the production Workers service as part of routine Pages maintenance.
- Keep canonical URLs and sitemap entries pointed at the Workers hostname until an intentional SEO migration updates every relevant reference together.
- Distinguish approved from published in any future content workflow.
- Verify external integrations and posting permissions before enabling actions that send messages or publish content.
