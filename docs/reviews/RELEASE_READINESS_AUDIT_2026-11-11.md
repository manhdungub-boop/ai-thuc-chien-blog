# Hồ sơ kiểm toán release readiness — 11/11/2026

## Phạm vi và nguyên tắc

- Repository duy nhất: `manhdungub-boop/ai-thuc-chien-blog`.
- PR trọng tâm: #96, branch `security/release-readiness-hardening-20261110`.
- Snapshot được kiểm tra trước khi ghi hồ sơ: PR #91 HEAD `c5d17ab60f033ed9e7026522d28a7e2d100db12e`; PR #95 HEAD `d86938debc516490cdd3ac2e8fc0ae9ddbd1fc74`; PR #96 HEAD `08a0120b99090de7cf83d5a0d156f5321e42e6e3`.
- Chỉ kiểm tra metadata PR, commit, CI, review, source/config và hồ sơ hiện có. Không đọc/tiết lộ secret values; không thay đổi Production Worker, DNS, D1, dữ liệu người dùng; không chạy migration; không gửi email; không merge hoặc deploy Production.

## PR stack và CI exact-head

| PR | Branch HEAD | State | CI evidence |
|---|---|---|---|
| #91 | `c5d17ab60f033ed9e7026522d28a7e2d100db12e` | Open / Draft | Commit-associated PR runs: Static CI, Content Quality, Website Health, Editorial, OAuth integration all success |
| #95 | `d86938debc516490cdd3ac2e8fc0ae9ddbd1fc74` | Open / Draft | Prior audit records exact-head Static CI run 42862801181 success; no PR-triggered run returned by current commit-run lookup |
| #96 | `08a0120b99090de7cf83d5a0d156f5321e42e6e3` | Open / Draft | Static CI run 42874750505 success; CodeQL run 42874750506 success; Staging Google OAuth mock integration run 42874750585 success |

For PR #96 HEAD `08a0120`, the three returned runs all completed successfully. Static CI has one successful validate job; CodeQL has successful JavaScript/TypeScript, Python and Actions jobs; OAuth integration has one successful job. The credential-free Auth Preview workflow was not present in the commit-associated run listing for this exact HEAD, so it is not marked PASS here. The latest audit's older exact-head PASS records are not substituted for current HEAD evidence.

## Source-level security review at PR #96 HEAD

- `.github/workflows/deploy-auth-app-preview.yml`: workflow is manual-dispatch only, checks out the selected source with `persist-credentials: false`, has `contents: read`, and runs static/build/regression checks only. It contains no Cloudflare token, relay secret, Google OAuth secret, deploy command, D1 operation or DNS operation. This removes the earlier branch-controlled build-hook/secret exposure path from this workflow.
- `email-relay/Code.gs`: missing relay host allowlist now becomes an empty list; requests require a configured allowed host. The relay checks a minimum 32-character shared secret, validates recipient and verification URL, rejects extra body URLs and unsafe HTML actions, and does not log payload/recipient/token/secret.
- `scripts/check-ai-tools-links.mjs`: resolves public addresses and pins the selected address into the actual HTTP(S) socket lookup; every redirect hop is revalidated and each bounded retry re-resolves/re-pins. Private IPv4/IPv6 addresses are rejected by the shared address-safety helper.
- PR #96 description records dummy PBKDF2 for unknown accounts, fail-closed relay allowlist, DNS-pinned requests, credential-free Auth Preview validation and offline-only Workers Builds updater. These changes have exact-head Static CI/CodeQL evidence above.
- Production Worker workflow source requires manual dispatch from `main` and explicit boolean confirmation. Pages deployment has the same main-ref + explicit confirmation boundary. This source inspection is not authorization to deploy.
- `wrangler.jsonc` declares separate Production and Preview D1 UUIDs. Preview identity is statically pinned; live schema/metadata remains unverified due missing API scope.

## Preview Worker / credential boundary — still blocked

Read-only inventory already recorded in the prior audit was reconciled against the current source policy:

1. Stable `ai-thuc-chien-blog-auth-app-preview`: dedicated Preview D1 UUID `51d814c8-a3fc-4481-a5f1-60bc67617f3c`; no secret binding was present in the latest metadata inventory. Relay URL is plain text. No relay secret or Google OAuth client credential binding was present. This explains why live relay and Google OAuth cannot be exercised on this stable Worker.
2. Legacy `ai-thuc-chien-blog-auth-preview`: a truncated/unexpected secret binding name was returned (`COMMUNITY_EMAIL_RELAY_SECR`) and a separate D1 UUID. Correctness, value provenance and isolation are unverified.
3. Legacy `ai-thuc-chien-blog-auth-isolated-20261104`: metadata showed the expected relay secret binding name and a separate D1 UUID. The value, provenance, and proof that it is disposable and distinct from Production are unverified.
4. The legacy Workers have public workers.dev hostnames enabled. Their ownership, active traffic, source/version provenance and rollback requirements are unresolved.

No secret values were requested or read. Do not copy, compare, rotate, delete, redeploy, alter bindings, or add either legacy hostname to OAuth allowlists until ownership, traffic and an independently proven disposable Preview credential boundary are established. Do not broaden OAuth allowlists to arbitrary Preview hostnames.

## D1 metadata

- Cloudflare D1 metadata/detail requests for the known Preview/legacy/Production database identifiers returned HTTP 401 / authentication error under the connected token because `d1.read` is absent.
- This is a permission limitation, not evidence of a database/schema defect. No SQL query, migration, D1 write or production schema change was performed in this round.
- Required next evidence: owner-authorized read-only `d1.read` access scoped to the necessary Preview database(s), then inspect metadata/schema without granting `d1.write`. Production D1 remains out of scope.

## Live OAuth and email

- OAuth integration run 42874750585 is mock/integration CI only. It does not prove a real Google consent redirect, callback, token exchange or session on a live Preview Worker.
- Live Preview provider endpoint was previously observed as `google:false, facebook:false`; stable Preview metadata lacks Google OAuth client credential bindings.
- Live email delivery/reset E2E is not verified; stable Preview has no relay secret binding. No external email was sent.
- Required next evidence: separately provisioned disposable Preview-only Google OAuth client and relay secret through the approved secret-management path; verify exact stable Preview hostname only; use an isolated test account and test inbox; do not reveal values or use Production credentials.

## Independent security review

- PR #95 and #96 have no recorded review submissions or inline review threads.
- PR #91 retains five unresolved Codex inline findings on an older reviewed commit. Four have downstream mitigations in PR #96 (dummy PBKDF2, fail-closed relay allowlist, DNS-pinned requests, credential-free Preview workflow). The Preview secret-boundary finding remains an open investigation item; the credential-free workflow removes the direct exposure path from that workflow but does not prove legacy Worker secret provenance.
- Codex review service previously reported its usage limit was exhausted. CodeMouse account status was recorded as inactive. CodeQL and scoped source review are useful free checks but are not an independent human security review.
- Do not claim independent review PASS until a genuinely independent reviewer completes a fresh review of the exact final PR head. Use a no-cost provider/reviewer only; no trial, paid plan or payment setup.

## Release gate

| Gate | Status | Evidence / remaining action |
|---|---|---|
| Static CI on PR #96 HEAD `08a0120` | PASS | Run 42874750505 |
| CodeQL on PR #96 HEAD `08a0120` | PASS | Run 42874750506; three language/workflow jobs success |
| OAuth mock/integration on PR #96 HEAD `08a0120` | PASS | Run 42874750585; not live OAuth |
| Credential-free Auth Preview on exact HEAD | NOT VERIFIED | No exact-head run returned |
| Stable Preview relay secret | BLOCKED | No dedicated secret binding |
| Live Google OAuth | BLOCKED | No Preview client credentials; provider previously false |
| Live email E2E | BLOCKED | No relay secret binding; no test email sent |
| Preview D1 metadata/schema | BLOCKED | Missing `d1.read`; HTTP 401 |
| Legacy Preview Worker provenance | BLOCKED | Two secret-bearing legacy metadata records unresolved |
| Independent security review | BLOCKED | No independent review submissions |
| Production release authorization | NOT GRANTED | No merge/deploy/migration authorization in this audit |

## Actions taken in this audit round

- Re-read current PR #91/#95/#96 metadata, branch heads, base relationships, review submissions, inline review threads, comments, changed-file inventory and commit-associated CI.
- Inspected current PR #96 Preview validation workflow, relay allowlist implementation, DNS-pinned link checker, D1 diagnostic workflow, release-safety verifier, Worker configuration and Production deployment guards.
- Confirmed the exact-head CI conclusions listed above.
- No application code, workflow, secret, Worker, DNS, D1, account, real user data or Production resource was modified by the audit.

## Decision

**NOT READY FOR RELEASE.** Keep PR #96 Draft/open and do not merge or deploy Production. Continue only with read-only inspection, credential-free CI, isolated Preview work and separately authorized Preview-only credential provisioning. Re-run only checks affected by subsequent changes, and record every PASS against the exact commit SHA.

## Addendum — xử lý quy tắc lỗi/PR và rà soát PR cũ (11/11/2026)

### Quy tắc làm việc mới

Đã ghi thành tài liệu bắt buộc: [docs/WORKING_RULES_ERROR_AND_PR_CONTROL.md](../WORKING_RULES_ERROR_AND_PR_CONTROL.md), commit `82544142943ff3618062e1b60766f2cd7702b181`.

Các nguyên tắc trọng yếu:
- Sửa nguyên nhân gốc và lỗi phát sinh trước khi mở rộng phạm vi.
- Ưu tiên tiếp tục trên PR/branch hiện hữu; không tạo PR mới để tách nhỏ không cần thiết, né CI đỏ hoặc che lỗi.
- Không bỏ qua, skip, nới assertion hay đổi điều kiện để làm xanh kiểm thử.
- Mọi PASS phải gắn SHA; không có workflow run không đồng nghĩa PASS.
- Khi CI lỗi do quota/dịch vụ ngoài, ghi BLOCKED và tìm phương án miễn phí; không tuyên bố PASS.
- Mỗi lỗi phải có regression test phù hợp và cập nhật hồ sơ kiểm toán.

### Rà soát PR cũ

Đã truy vấn PR đang mở và commit-associated workflow runs trên HEAD của các PR #94, #93, #92, #90, #89, #88, #87, #85, #84, #83, #82, #77, #76, #75, #74, #73, #72, #71, #70, #67, #62, #30, #21 và #20.

- Với các HEAD được truy vấn của #93, #92, #89, #88, #85, #83, #82, #77, #76, #75, #74, #73, #72, #71, #70, #67, #62, #30, #21 và #20, những workflow run được API trả về đều có conclusion success.
- Với #94, #90, #87 và #84, không có commit-associated workflow run được trả về. Đây là NOT VERIFIED, không phải PASS.
- Không có failed conclusion nào xuất hiện trong tập commit-associated runs được truy vấn ở đợt này. Tuy nhiên, điều đó không chứng minh mọi job lịch sử, mọi lần rerun hoặc toàn bộ PR cũ đều sạch lỗi.
- PR #88, #21 và #20 hiện được metadata báo mergeable=false; cần điều tra conflict/base cũ trước khi xem xét. PR #67 cũng mergeable=false. Không tự ý đóng hoặc merge.
- Nhiều PR cũ dùng base branch/commit khác nhau; không dùng CI PASS lịch sử của chúng làm bằng chứng cho PR #96 hoặc release hiện tại.

### PR #96 sau cập nhật quy tắc

- HEAD mới nhất: `82544142943ff3618062e1b60766f2cd7702b181`.
- PR #96 vẫn Open / Draft, chưa merge.
- Sau commit tài liệu, GitHub trả về OAuth integration run `42878357136` đang chạy và CodeQL run `42878357351` đang queued tại thời điểm kiểm tra.
- Không có Static CI run được trả về cho commit tài liệu này; do đó không ghi Static CI PASS trên SHA mới. Kết quả Static CI/CodeQL/OAuth của SHA cũ không được kế thừa sang SHA mới.
- Việc thêm tài liệu không thay đổi mã ứng dụng; không chạy lại toàn bộ test suite. Chờ các workflow có liên quan hoàn tất và tiếp tục kiểm tra CI chính xác theo SHA mới.

### Quyết định

Giữ PR #96 ở Draft. Tiếp tục xử lý blocker Preview credentials, live Google OAuth, live email, D1 read-only metadata và independent security review. Chỉ mở PR khác khi có lý do kỹ thuật bắt buộc và đã ghi rõ; trước tiên phải rà soát/khắc phục PR cũ và kết quả kiểm thử lỗi.

## Addendum — tiếp tục kiểm tra PR #96 và D1 access (11/11/2026)

### Trạng thái mới nhất trên HEAD `6bdcefe59ac7ac78fe98ccae6d7eb074d741bf98`

PR #96 vẫn Open / Draft, chưa merge; base PR #95. PR #95 vẫn base trên PR #91. Cả ba PR cha/con vẫn Open / Draft.

Các workflow gắn trực tiếp với HEAD này đã hoàn tất:
- Static CI Quality Gate — run `42878507409`, job `validate`: success.
- CodeQL Offline Security Analysis — run `42878507355`, jobs Analyze actions, javascript-typescript và python: success.
- Staging Google OAuth integration — run `42878507229`, job `staging-google-oauth`: success.

Ba kết quả trên là PASS trên đúng SHA `6bdcefe`; OAuth là mock/integration, không phải đăng nhập Google thật. Không có kết quả CI nào bị kế thừa từ SHA trước.

### Rà soát lại các findings còn mở trên PR #91

Năm review threads Codex cũ vẫn unresolved trên PR #91:
1. Branch-controlled build hook có thể chạy dưới token triển khai Preview.
2. DNS rebinding giữa bước resolve và fetch.
3. Relay allowlist fallback sang hostname Production.
4. Timing khác biệt khi email không tồn tại.
5. Worker Preview branch code có thể đọc secret binding cũ.

Đối chiếu source trên PR #96 HEAD:
- `.github/workflows/deploy-auth-app-preview.yml` hiện chỉ là manual, credential-free static/build/regression validation; checkout `persist-credentials: false`; không chứa Cloudflare token, relay secret, Google OAuth secret, lệnh deploy, D1 hay DNS. Finding 1 về workflow này được giảm thiểu bằng cách bỏ deploy/credential khỏi workflow; không còn đúng với chức năng hiện tại của file này.
- `scripts/check-ai-tools-links.mjs` đã pin địa chỉ IP được xác thực vào socket lookup; mỗi redirect hop và retry đều resolve/revalidate lại. Finding 2 có mitigation trong source hiện tại.
- `email-relay/Code.gs` fail closed khi allowlist thiếu; không fallback sang hostname Production. Finding 3 có mitigation trong source hiện tại.
- `worker.mjs` thực hiện dummy PBKDF2 cho user không tồn tại. Finding 4 có mitigation trong source hiện tại.
- Finding 5 chưa thể coi là đóng: workflow credential-free không triển khai branch code lên Worker có secret, nhưng hai Worker Preview legacy còn metadata secret binding chưa xác minh nguồn gốc/traffic. Không đọc hoặc thay đổi secret; cần xác minh ownership, source/version, traffic và credential boundary trước khi kết luận.

Các review threads cũ được giữ nguyên để bảo toàn lịch sử. Chưa resolve thủ công vì PR #91 vẫn là PR riêng trong stack và cần reviewer xác nhận mitigation trên đúng diff.

### Kiểm tra D1 permission

Đã thực hiện duy nhất một yêu cầu Cloudflare API GET metadata cho Preview database UUID đã biết `51d814c8-a3fc-4481-a5f1-60bc67617f3c`. Kết quả HTTP 401, yêu cầu scope `d1.read` (D1 Read). Không có SQL query, D1 write, migration hay thay đổi database.

Đã khởi tạo kết nối Cloudflare qua Composio để thay thế quyền truy cập hiện tại; trạng thái kết nối là pending, cần chủ tài khoản hoàn tất xác thực và cấp quyền tối thiểu D1 Read. Chưa thực thi bất kỳ Composio Cloudflare action nào khi chưa có kết nối Active.

### Kết luận cập nhật

- Static CI / CodeQL / OAuth mock: PASS trên `6bdcefe`.
- Findings 1–4 của PR #91: source mitigation đã được xác minh trong PR #96; vẫn giữ nguyên thread lịch sử.
- Finding 5 / legacy Preview secret provenance: BLOCKED.
- D1 metadata: BLOCKED bởi thiếu `d1.read`.
- Live Google OAuth, live email và independent security review: BLOCKED.
- Release: **NOT READY**. Không merge, không deploy Production, không thay đổi Production Worker/DNS/D1/secrets.


## Addendum — xác minh CI mới nhất và trạng thái kết nối Cloudflare (11/11/2026)

### Exact-head verification: `7a45205927ff125081256d7019d5467ec04faec2`

Đã kiểm tra lại PR #96 trực tiếp trên GitHub: Open / Draft, chưa merge; branch `security/release-readiness-hardening-20261110`; base là PR #95; GitHub trả về mergeable=true tại thời điểm truy vấn.

Ba workflow gắn với đúng SHA này đã hoàn tất:
- Static CI Quality Gate — run `42881695676`, job `validate`: SUCCESS.
- CodeQL Offline Security Analysis — run `42881695739`, jobs Analyze actions, javascript-typescript và python: SUCCESS.
- Staging Google OAuth integration — run `42881695740`, job `staging-google-oauth`: SUCCESS.

Static CI job đã chạy build static site/SEO feeds, JavaScript syntax, Worker security headers, D1 schema/config regression, OAuth migration rehearsal, article/content quality, AI Bank catalog, isolated Chromium browser regression, official AI tool links, article attribution/diagrams, SEO, accessibility/performance basics, copy prompt interactions, article navigation và homepage coverage. CodeQL hoàn tất cả ba nhóm phân tích. OAuth workflow là kiểm thử tích hợp với D1 mock cô lập; không chứng minh Google OAuth thật hoặc đăng nhập vào tài khoản Google thật.

PR #96 không có review submissions hoặc inline review threads. Các review findings cũ trên PR #91 vẫn được bảo toàn theo lịch sử; việc mitigation trong PR #96 không tự động đóng các thread của PR #91.

### Cloudflare D1 read-only connection

Đã dùng Composio discovery để tìm đúng các thao tác metadata D1 và Worker metadata. Kết quả xác nhận chưa có Cloudflare connection Active. Đã khởi tạo một kết nối mới có alias `AI Thuc Chien Blog - Preview D1 read-only audit`; trạng thái hiện là `initiated/pending`, chưa Active. Vì vậy chưa gọi bất kỳ Cloudflare tool nào qua Composio.

Khi hoàn tất kết nối, chỉ dùng thao tác đọc metadata cho Preview D1 UUID `51d814c8-a3fc-4481-a5f1-60bc67617f3c`. Không yêu cầu D1 Write, không chạy SQL, không truy cập Production D1. Nếu màn hình cấp quyền yêu cầu quyền ghi hoặc quyền rộng không cần thiết, dừng lại.

### Release gate after exact-head verification

| Gate | Status | Evidence |
|---|---|---|
| Static CI | PASS | Run 42881695676 on exact SHA above |
| CodeQL (Actions, JS/TS, Python) | PASS | Run 42881695739 on exact SHA above |
| OAuth mock/integration | PASS | Run 42881695740 on exact SHA above; not live Google OAuth |
| Real Google OAuth | BLOCKED | Preview OAuth credentials/provider configuration not verified |
| Real email relay delivery | BLOCKED | Preview-only relay credential and delivery E2E not verified |
| Preview D1 metadata | BLOCKED | Requires authorized Active connection with D1 Read only |
| Legacy Preview secret provenance | BLOCKED | Binding names/values provenance and traffic ownership remain unresolved; no secret values read |
| Independent security review | BLOCKED | No independent review submissions on PR #96 |
| Production release | NOT AUTHORIZED | No merge, Production deployment, DNS, D1 migration or secret changes |

### Decision

**NOT READY FOR RELEASE.** Keep PR #96 Open / Draft. Continue safe read-only verification and exact-scope Preview work after the least-privilege Cloudflare connection becomes Active. No Production resources or credentials were changed.
