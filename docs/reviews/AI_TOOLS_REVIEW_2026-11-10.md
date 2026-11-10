# Báo cáo rà soát Ngân hàng AI — 10/11/2026

## Phạm vi

- Nhánh ứng viên: `fix/release-blockers-20261109` (PR #91 tới `main`).
- Catalog trước rà soát: 27 bản ghi.
- Hàng chờ `data/review/ai-tools-candidates-2026-11-02.json`: 9 ứng viên.
- Đối chiếu ID, tên, vendor và website trước khi thêm; chỉ nhập các hồ sơ có nguồn chính thức đủ để xác nhận phần mềm, giấy phép và mô hình chi phí.

## Kết quả

| Chỉ số | Trước | Sau |
|---|---:|---:|
| Bản ghi catalog | 27 | 35 |
| Bản ghi active | 26 | 34 |
| Bản ghi deprecated | 1 | 1 |
| Bản ghi `needs_review` | 2 | 2 |
| Ứng viên còn chờ rà soát | 9 | 1 |

Đã bổ sung 8 công cụ, tất cả `verification_status=verified`, `status=active`, `last_verified=2026-11-10`:

1. **AnythingLLM** — core MIT; desktop và self-host Docker miễn phí; Cloud Basic 50 USD/tháng và Pro 99 USD/tháng tại thời điểm kiểm tra. Model/API kết nối ngoài có thể phát sinh phí riêng.
2. **OpenCode** — coding agent mã nguồn mở MIT; phần mềm không thu phí license, nhưng inference/API phụ thuộc nhà cung cấp model.
3. **ComfyUI** — core GPL-3.0, chạy local miễn phí; Comfy Cloud và Partner Nodes là dịch vụ dùng credits/chi phí riêng. Model và custom node có giấy phép riêng.
4. **Qdrant** — server Apache-2.0; Qdrant Cloud Free forever cho thử nghiệm/prototype với một node, 0.5 vCPU, 1 GB RAM, 4 GB disk; các tier khác tính phí theo mức sử dụng hoặc yêu cầu tối thiểu.
5. **whisper.cpp** — triển khai C/C++ theo MIT, có thể chạy nhận dạng giọng nói offline sau khi tải model. License model và dependency phải được kiểm tra riêng.
6. **MLflow** — nền tảng open-source Apache-2.0; không thu phí license phần mềm, nhưng hạ tầng tự host và dịch vụ bên thứ ba có chi phí riêng.
7. **Pydantic AI** — Python agent SDK MIT; SDK miễn phí, chi phí model/API và dịch vụ Pydantic khác được tách riêng.
8. **Haystack** — framework Apache-2.0; deepset Studio công bố gói 0 USD gồm 1 workspace, 1 user, 100 pipeline hours, 50 files tối đa 10 MB/file và 2 development pipelines; Enterprise báo giá riêng.

## Hồ sơ vẫn cần rà soát

- **EasyOCR** — giữ `needs_review`: license của từng pretrained checkpoint chưa được xác định rõ; không suy rộng license Apache-2.0 của code sang model weights.
- **Flowise** — giữ `deprecated` + `needs_review`: upstream đã công bố sunset/EOL; không khuyến nghị triển khai mới và không suy đoán giá Cloud sau EOL. Record bị ẩn khỏi danh sách active công khai.
- **ElevenLabs** — vẫn ở hàng chờ `needs_review`; chưa đưa vào catalog vì cần xác minh lại chính sách credits, giới hạn gói Free và điều kiện thương mại từ trang giá hiện hành.

Các bản ghi Hugging Face Hub và Adobe Firefly hiện đã qua rà soát trước đó và có trạng thái `verified`; báo cáo cũ ghi trạng thái `needs_review` là lịch sử tại thời điểm cũ, không phải trạng thái hiện tại.

## Nguồn chính thức

- AnythingLLM: https://github.com/Mintplex-Labs/anything-llm ; https://docs.anythingllm.com/installation-desktop/overview ; https://anythingllm.com/cloud
- OpenCode: https://opencode.ai/ ; https://opencode.ai/docs ; https://github.com/anomalyco/opencode ; https://github.com/anomalyco/opencode/blob/dev/LICENSE
- ComfyUI: https://www.comfy.org/download/ ; https://support.comfy.org/articles/9806306061-about-comfy ; https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE ; https://www.comfy.org/cloud
- Qdrant: https://qdrant.tech/ ; https://qdrant.tech/pricing/ ; https://github.com/qdrant/qdrant
- whisper.cpp: https://github.com/ggml-org/whisper.cpp ; https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE ; https://github.com/ggml-org/whisper.cpp/releases
- MLflow: https://mlflow.org/ ; https://mlflow.org/docs/latest/ ; https://github.com/mlflow/mlflow
- Pydantic AI: https://ai.pydantic.dev/ ; https://github.com/pydantic/pydantic-ai ; https://github.com/pydantic/pydantic-ai/blob/main/LICENSE
- Haystack: https://haystack.deepset.ai/ ; https://docs.haystack.deepset.ai/docs/intro ; https://github.com/deepset-ai/haystack/blob/main/LICENSE ; https://www.deepset.ai/pricing

## Kiểm tra và ranh giới phát hành

- Đã cập nhật hàng chờ ở cả `data/review/` và bản mirror trong `docs/reviews/`; 8 hồ sơ đã chuyển vào catalog, ElevenLabs vẫn pending.
- Đã sửa browser E2E để tính theo số active thực tế, phân biệt record `deprecated` với record `needs_review`, kiểm tra khả năng tìm kiếm 8 công cụ mới và phân trang 24 + 10.
- **PASS — catalog validator:** `node scripts/validate-ai-tools-catalog.mjs` xác nhận 35 bản ghi, 35 ID duy nhất; một cảnh báo hợp lệ cho EasyOCR đang `needs_review`.
- **PASS — strict audit:** `node scripts/audit-ai-tools-catalog.mjs ... --strict --as-of=2026-11-10` không có strict blocker, không stale record, không trùng ứng viên/catalog; 2 hồ sơ cần rà soát là Flowise và EasyOCR, 1 ứng viên pending là ElevenLabs.
- **PASS — UI/data contract:** `node scripts/test-ai-tools-catalog-ui.mjs` xác nhận JSON, HTTPS sources, script UI, tìm kiếm/lọc/sắp xếp/phân trang và Worker static asset contract.
- **PASS — Chromium E2E (GitHub Actions, 10/11/2026):** 35 bản ghi / 34 active; phân trang 24 + 10; tìm kiếm 8 công cụ bổ sung; canonical IDs; sắp xếp A–Z; bộ lọc review; Preview noindex và cô lập dữ liệu ứng viên. Kết quả được xác nhận trong CI run `42859515305` trên commit `8697dfad82dccc15cefc6a8db93fdaa876b7dd93`.
- **CI finding / fix:** PR #91 run `42675512813` failed at `scripts/test-ai-tools-catalog-audit.mjs` because the test hard-coded `--as-of=2026-11-08`. The test now uses the current `Asia/Ho_Chi_Minh` date. GitHub CI run `42859515305` on commit `8697dfad82dccc15cefc6a8db93fdaa876b7dd93` passed, including the catalog audit and Chromium E2E.
- Không có tài khoản trả phí, API key, trial, credits hoặc dịch vụ trả phí nào được tạo/sử dụng.
- Chỉ cập nhật nhánh ứng viên; không sửa `main`, không merge PR #91/#92/#93, không deploy Production, không thay đổi D1, DNS hoặc secrets.

- **Security follow-up:** GitHub CodeQL run `42859495707` passed for JavaScript/TypeScript, Python and GitHub Actions. Google OAuth integration run `42859496409` passed. Official link audit run in CI `42859515305`: 144 URLs checked, 136 reachable, 8 exact official source URLs manually verified after transient GitHub 503 responses, 0 broken and 0 inconclusive. The manual-verification exception is restricted to exact publisher URLs, not whole domains.
- **IPv6 regression coverage:** `scripts/test_ipv6_address_safety.mjs` passed all 18 offline IPv4/IPv6 address-safety cases in GitHub CI run `42861324332`.


## Latest verified release-readiness snapshot — 2026-11-10

- PR #96 exact validated source before the final test-log-only commit: `f04dc094c7bade4a32f0551c6e6d1290856bc02d`.
- Static CI run [#42861324332](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42861324332) completed **SUCCESS** on that exact commit.
- Official catalog links: 144 checked; 136 reachable; 8 exact publisher URLs manually verified; 0 broken; 0 inconclusive. Manual exceptions are URL-specific, not host-wide. Five transient GitHub source URLs were independently fetched through the GitHub contents API; a further three were verified the same way. The checker now uses bounded exponential backoff for 502/503/504 responses.
- Chromium AI Bank E2E: **PASS** — 35 total records, 34 active, pagination 24 + 10, eight new-tool search cases, canonical IDs, sorting, review filtering, Preview noindex and candidate isolation.
- Content and site checks: **PASS** — 69 articles; 69 author/attribution checks; 69 unique SVG diagrams; static build; 69-article SEO/sitemap/RSS parity; 74-page accessibility/performance checks.
- Security regressions: **PASS** — 18 offline IPv4/IPv6 cases; login timing; relay allowlist; DNS rebinding; credential-free Preview; Workers Builds offline-only guard; Production deploy confirmation; Preview D1 UUID pinning; Cloudflare secret-bearing workflow dispatch guards.
- Google OAuth integration workflow run [#42861324322](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42861324322) completed **SUCCESS** using local mocks and in-memory SQLite. This validates OAuth state/PKCE/nonce/OIDC/session/migration logic; it is not a live Google OAuth redirect using real credentials.
- Credential-free Auth Preview static/build validation run [#42861100315](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42861100315) completed **SUCCESS** on the same source commit; no Worker deploy, Cloudflare secret, D1 operation, DNS change or Production operation.
- CodeQL run [#42861324288](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42861324288) was still completing its JavaScript/TypeScript matrix at the time of this note; record its final result only after all matrix jobs complete.
- A final reporting-only assertion was added to print the successful checkout-token isolation check. The exact new HEAD must complete CI again before the PR can be treated as fully validated.
- Remaining release blockers are not waived by these passing checks: PR #96 is Draft and stacked on PR #95 → PR #91; independent security review is outstanding; live Google OAuth E2E with the separately authorized Preview test path is outstanding; legacy Preview Worker inventory/binding ownership remains unresolved and must not be altered without verified identity and authorization.
- No merge, deployment, Production Worker, D1, DNS, secrets or real user data were changed.


## Parent-stack and Preview-secret follow-up — 2026-11-11

- Parent PR #91 branch `fix/release-blockers-20261109`, HEAD `c5d17ab60f033ed9e7026522d28a7e2d100db12e`: Static CI run [42862801253](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42862801253) **SUCCESS**.
- Parent PR #95 branch `security/pin-verified-actions-20261110`, HEAD `d86938debc516490cdd3ac2e8fc0ae9ddbd1fc74`: Static CI run [42862801181](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42862801181) **SUCCESS**.
- Current PR #96 HEAD `27e69e0702833fe39ff962081fbee7812efcbdb6`: Static CI run [42862305510](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42862305510) **SUCCESS**; CodeQL [42862431679](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42862431679) **SUCCESS** (JavaScript/TypeScript, Python, Actions; 0 findings each); OAuth mock integration [42862430599](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42862430599) **SUCCESS**; credential-free Auth Preview validation [42862505112](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42862505112) **SUCCESS**.
- GitHub reports PRs #91, #95 and #96 all remain open Draft PRs; no merge has occurred. PR #96 is currently mergeable according to GitHub, but this is not release approval.
- Review inventory: PR #91 still has five unresolved inline Codex threads created against an older commit. Four findings have corresponding downstream mitigations in PR #96 (dummy PBKDF2, fail-closed relay allowlist, DNS-pinned requests, credential-free Auth Preview workflow). The fifth finding concerns the Preview Worker secret boundary. PR #95 and PR #96 have no recorded review submissions or inline review threads. Codex's prior comment states the review quota was exhausted; do not repeatedly trigger the same exhausted review service.
- Cloudflare's PR bot independently reports a successful automatic Preview deployment for commit `27e69e0` at `https://d914963f-ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev`. This deployment is separate from GitHub's credential-free `deploy-auth-app-preview.yml` validation workflow, which performs static/build checks only.
- `wrangler.jsonc` pins the Preview D1 binding to `51d814c8-a3fc-4481-a5f1-60bc67617f3c`, distinct from the top-level Production D1 ID `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`. CI verifies this Preview UUID guard. Cloudflare's Preview documentation describes Preview-specific variables, secrets and bindings: https://developers.cloudflare.com/workers/previews/configuration/.
- **Still unverified / release blocker:** whether the automatically deployed Preview environment has a dedicated disposable `COMMUNITY_EMAIL_RELAY_SECRET` distinct from Production, and whether that binding is inaccessible to any other Preview. No secret values were read, listed, copied, rotated or changed. Do not run real OAuth/email E2E against this Preview until the owner verifies the Preview-only secret boundary and confirms the isolated test account.
- **Still unverified / release blocker:** live Google OAuth remains unavailable in the previously inspected stable Preview provider response (`google:false`); the current exact-head Preview's live provider response has not been re-read. Mock OIDC tests do not prove a live Google redirect or email delivery.
- Source-level confirmation: `worker.mjs` deliberately allows OAuth only on `https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev`. The current branch Preview URL is branch-prefixed (`security-release-readiness-ai-thuc-chien-blog-auth-app-preview...`) and is intentionally rejected by that allowlist. Do not broaden the allowlist to arbitrary PR hosts; live OAuth must use the dedicated stable staging hostname after its code/runtime and Preview-only secrets are safely provisioned.
- The Cloudflare API connection previously returned 403 for direct D1 schema query; the current branch config and CI verify the Preview UUID, but no live D1 schema query or migration was run. Production D1 remains untouched.
- No Production Worker, Production D1, DNS, secrets, real user data, merge or Production deployment was changed.


## Read-only Cloudflare Preview verification — 2026-11-11

- Cloudflare API read-only inspection of the stable Preview Worker `ai-thuc-chien-blog-auth-app-preview` succeeded. The returned binding metadata contains the Preview D1 binding `51d814c8-a3fc-4481-a5f1-60bc67617f3c`, matching the reviewed Preview UUID and distinct from Production D1.
- The stable Preview Worker currently has `COMMUNITY_EMAIL_RELAY_URL` as plain text but **does not have** a `COMMUNITY_EMAIL_RELAY_SECRET` secret binding. The secret-name inventory for this Worker was empty. No secret value was requested or exposed. This establishes that this specific stable Preview Worker currently has no relay secret binding; it does not prove that any other Worker or Cloudflare environment has an isolated disposable secret.
- The branch-prefixed Worker name `security-release-readiness-ai-thuc-chien-blog-auth-app-preview` returned Cloudflare 404 (Worker does not exist). No branch Worker was created or modified.
- The current PR #96 `.github/workflows/deploy-auth-app-preview.yml` is credential-free: it checks out the selected ref with `persist-credentials: false`, runs build/static/regression checks, and contains no Cloudflare API token, application secret, deployment command, D1 operation or DNS operation. This removes the reviewed branch-controlled build-hook exposure path from this workflow.
- The Production Worker workflow remains restricted to manual dispatch from `main` with the explicit `confirm_production_worker_and_d1_changes == true` input. Its privileged steps are not runnable from a PR branch under the workflow condition. This is a control observation, not authorization to deploy.
- GitHub's commit-associated run listing for HEAD `6a4d084be02250d4bd7b744906d961dbfd4ad6f7` reports Static CI, CodeQL and staging OAuth integration all completed successfully (run IDs `42863561927`, `42863561862`, `42863561701`). This listing is the evidence used for this snapshot.
- **Remaining blockers:** stable Preview has no relay secret binding, so live email verification/reset E2E cannot pass until a dedicated disposable Preview-only secret is provisioned by the owner; live Google OAuth and real email E2E remain untested; independent security review remains outstanding; Flowise/EasyOCR editorial flags and the ElevenLabs candidate remain unresolved.
- No Cloudflare settings, secrets, Worker code, D1 data/schema, DNS, GitHub PR state, Production resources or user data were changed by this inspection.


## Legacy Preview Worker inventory recheck — 2026-11-11 (read-only)
- Re-read Cloudflare Worker settings and deployment metadata for three exact script names; no mutation endpoints were called.
- `ai-thuc-chien-blog-auth-app-preview`: active deployment routes 100% to version `c26fd6da-7b11-4e03-a5cc-695d6a3a61a5`; D1 binding `DB` points to Preview database `51d814c8-a3fc-4481-a5f1-60bc67617f3c`; no `secret_text` binding is present. Deployment metadata returned 10 deployments.
- `ai-thuc-chien-blog-auth-preview`: active deployment routes 100% to version `7f314c5e-de76-4f57-bf7c-479117f8a8f9`; D1 binding `DB` points to `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`; settings expose a `secret_text` binding whose returned name is truncated as `COMMUNITY_EMAIL_RELAY_SECR`. Deployment metadata returned 10 deployments. This is binding metadata only; no secret value was read and no claim is made about whether its value is valid, disposable, or distinct from Production.
- `ai-thuc-chien-blog-auth-isolated-20261104`: active deployment routes 100% to version `3eed369b-b997-46c5-a3ae-8b94494f86ea`; D1 binding `DB` points to `3c3e6410-17ab-49dd-9151-012acc085286`; settings expose a `COMMUNITY_EMAIL_RELAY_SECRET` `secret_text` binding. Deployment metadata returned 9 deployments. This is binding metadata only; secret value and environment separation remain unverified.
- These are three distinct Workers with distinct D1 IDs. Their intended ownership, traffic role, and whether the two secret-bearing Workers are still required are not established. Do not delete, redeploy, change bindings, or rotate secrets until owners/traffic/rollback requirements are reconciled and the secret boundary is independently proven.
- GitHub commit-associated PR workflow listing for documentation commit `8670812839b0d99c9a898078802f50edd71337e5` returned no runs. The preceding CI results on `6a4d084be02250d4bd7b744906d961dbfd4ad6f7` do not validate this later documentation-only commit. Trigger/obtain a suitable non-production static check for the exact latest PR HEAD before treating the documentation update as validated.
- No Cloudflare setting, Worker, deployment, secret, D1 database/data/schema, DNS, GitHub PR state, Production resource, or user data was changed by this recheck.

- Follow-up D1 database metadata GETs for the four known IDs (Preview `51d814c8-a3fc-4481-a5f1-60bc67617f3c`, legacy Preview `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`, isolated Preview `3c3e6410-17ab-49dd-9151-012acc085286`, and Production `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`) returned HTTP 401 / Cloudflare error 10000 because this connector lacks `d1.read` scope. No D1 read/write was performed. Treat database names and runtime/schema state as unverified; do not grant `d1.write` for this investigation.
- The GitHub commit-run lookup wrapper used here returns PR-triggered runs only; an empty result for `48f271d6e1ae97c589767d968edaf3390472bd93` means no PR-triggered run was returned by that query, not proof that no push/scheduled run exists. Exact-HEAD CI status therefore remains unverified through this lookup.


## Preview exposure and relay binding cross-check — 2026-11-11 (read-only)
- Cloudflare subdomain metadata confirms `workers.dev` is enabled on all three inspected Workers. Per-script preview URLs are enabled on `ai-thuc-chien-blog-auth-app-preview` and `ai-thuc-chien-blog-auth-isolated-20261104`, and disabled on `ai-thuc-chien-blog-auth-preview`. This means the two legacy secret-bearing scripts have a public workers.dev hostname enabled; it does not establish whether sensitive routes are exploitable. Keep them as security investigation items until request telemetry, source/version provenance, and owner intent are reconciled.
- Current reviewed `worker.mjs` source at blob SHA `56c7428cfac378075317a88926c303dbfd060620` requires the exact binding name `COMMUNITY_EMAIL_RELAY_SECRET` for registration/password-reset relay operations. The older `auth-preview` metadata returns the different/truncated binding name `COMMUNITY_EMAIL_RELAY_SECR`; therefore do not count that Worker as correctly configured for the current source without further verification. The isolated Worker metadata returns the exact expected binding name, but its secret value, provenance, and separation from Production are not verified.
- Current branch OAuth allowlist contains only the stable `ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev` origin; neither legacy Worker hostname is allowlisted. Do not add legacy or arbitrary Preview origins as a workaround.
- No public host was probed with credentials or secret-bearing payloads. No Worker/subdomain/secret/D1 setting was changed.


## Exact-HEAD validation completed — 2026-11-11
- On exact PR head `51dae4eca399bdd072817323c6c935bbd4f7177c`, Static CI Quality Gate run [`42868443299`](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42868443299) completed with conclusion `success`. All substantive jobs completed successfully, including build, syntax, Worker/security regression suite, local D1 schema and SQLite migration rehearsal, Preview D1 UUID guard, content, AI Bank catalog/browser regression, official link checks, attribution/diagram validation, SEO, accessibility/performance, copy interactions, navigation, and homepage coverage.
- Credential-free Auth Preview validation [`42868444107`](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42868444107) completed with conclusion `success` on the same exact HEAD. This is static/build validation only, not a deployed runtime or live OAuth/email E2E.
- GitHub CodeQL Offline Security Analysis [`42868306630`](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42868306630) and Staging Google OAuth integration [`42868306591`](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42868306591) also completed successfully on the same exact HEAD. OAuth integration is CI/mock validation, not proof of live Google account login on a real Preview Worker.
- The earlier commit-associated lookup's empty response was a limitation of that lookup path. A subsequent repository/workflow run listing found the above exact-SHA runs; therefore the previous uncertainty about exact-HEAD CI is resolved.
- These results do not resolve the outstanding secret-boundary and legacy Worker exposure questions, D1 API metadata permission gap, live Google OAuth/email E2E, or independent security review. No Production change was authorized or performed.
