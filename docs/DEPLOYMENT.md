# Deployment and maintenance

## Live endpoints

- Primary: https://ai-thuc-chien-blog.manhdungub.workers.dev/
- Cloudflare Pages: https://ai-thuc-chien-blog.pages.dev/
- GitHub Pages backup: https://manhdungub-boop.github.io/ai-thuc-chien-blog/

## Cloudflare Pages automatic deployment

The workflow `.github/workflows/deploy-cloudflare-pages.yml` runs on every push to `main` and can also be run manually from GitHub Actions.

The workflow copies only the intended static website files into `dist/`, then runs `wrangler pages deploy`. This is intentional because the Pages project uses Direct Upload; this workflow provides automated deployments from GitHub without changing the project type.

Required GitHub Actions repository secret: `CLOUDFLARE_API_TOKEN`.

The token is limited to Pages Read and Pages Write for the intended Cloudflare account. Its current expiry is 2027-04-18; rotate it before that date and update the repository secret.

## Verification checklist

1. Open the Pages URL and confirm the homepage is HTTP 200.
2. Verify `styles.css`, `script.js`, `robots.txt`, `sitemap.xml`, `favicon.svg`, `404.html`, and the three article files return HTTP 200.
3. Inspect the latest `Deploy Cloudflare Pages` workflow run and confirm every step succeeds.
4. Compare the deployed static files to the matching files on the `main` branch when troubleshooting.

## Safe operating rules

- Do not delete the production Workers deployment; it remains the primary endpoint.
- Keep canonical and sitemap URLs pointed at the primary Workers hostname until an explicit SEO migration is planned.
- Do not commit API tokens, passwords, or other secrets to the repository.


## Current article library

- articles/bat-dau-voi-ai.html — nhập môn AI trong công việc.
- articles/quy-trinh-ai-co-kiem-duyet.html — quy trình có người kiểm duyệt.
- articles/ban-do-cong-cu-blog-ai.html — bản đồ công cụ cho blog AI.
- articles/kiem-chung-noi-dung-ai.html — checklist xác minh trước khi xuất bản.
