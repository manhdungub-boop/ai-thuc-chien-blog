#!/usr/bin/env node
'use strict';
const token = String(process.env.CLOUDFLARE_WORKERS_BUILDS_API_TOKEN || '');
const accountId = '92cf091bbac8b4879ec65feb30b4715b';
if (!token) {
  console.log('CF_PREVIEW_FLAG_CHECK=skipped (read-only Cloudflare token unavailable)');
  process.exit(0);
}
for (const name of ['ai-thuc-chien-blog', 'ai-thuc-chien-blog-moi']) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${name}/subdomain`;
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success !== true) {
      const codes = Array.isArray(body.errors) ? body.errors.map((item) => item.code).filter(Boolean).join(',') : '';
      console.log(`CF_PREVIEW_FLAG_CHECK worker=${name} http=${response.status} success=false error_codes=${codes || 'unavailable'}`);
      continue;
    }
    const result = body.result || {};
    console.log(`CF_PREVIEW_FLAG_CHECK worker=${name} enabled=${Boolean(result.enabled)} previews_enabled=${Boolean(result.previews_enabled)}`);
  } catch (error) {
    console.log(`CF_PREVIEW_FLAG_CHECK worker=${name} network_error=${String(error?.name || 'Error')}`);
  }
}
