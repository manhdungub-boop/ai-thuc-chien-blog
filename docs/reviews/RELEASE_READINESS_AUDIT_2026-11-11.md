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


## Addendum — Cloudflare connection activated; credential validation blocked (11/11/2026)

### Exact PR #96 head and CI
Latest PR #96 head at this check: `d561abcf81ed4d1e0a065d5970e866d763dd4f8a`. PR remains Open / Draft / unmerged.

- Static CI Quality Gate run `42884701911`, job `validate`: SUCCESS. All listed build, Worker, D1 schema/config, OAuth migration rehearsal, AI Bank Chromium, links, article attribution, SEO, accessibility, prompt interactions, navigation and homepage steps completed successfully.
- CodeQL Offline Security Analysis run `42884702158`: Analyze actions, javascript-typescript and python all SUCCESS, including focused regressions and local SARIF summaries.
- Staging Google OAuth integration run `42884701909`, job `staging-google-oauth`: SUCCESS. This uses isolated D1 mock and does not prove live Google OAuth.

### Cloudflare connection attempt
The user confirmed completion of the Composio Cloudflare authorization link. A subsequent Composio connection-list call confirmed account alias `AI Thuc Chien Blog - Preview D1 read-only audit` as `ACTIVE`.

A single read-only `CLOUDFLARE_LIST_ACCOUNTS` metadata request was then attempted through this connection to identify the account before accessing Preview D1. Cloudflare rejected the request with HTTP 400: invalid request headers / invalid format for `X-Auth-Key`. No account metadata was returned. No D1 metadata request, SQL, write, migration, Worker, DNS or secret action was performed.

This is an authentication/configuration failure despite Composio reporting the connection as Active. Do not retry D1 operations or use another credential path until the Cloudflare connection is corrected and validated. No secret value was read or stored.

### Updated release gates
| Gate | Status | Evidence |
|---|---|---|
| Static CI | PASS | Run 42884701911 on exact SHA above |
| CodeQL (Actions, JS/TS, Python) | PASS | Run 42884702158 on exact SHA above |
| OAuth mock/integration | PASS | Run 42884701909 on exact SHA above; not live OAuth |
| Cloudflare connection status | ACTIVE, API AUTH FAILED | Composio list confirms Active; Cloudflare API rejected X-Auth-Key header |
| Preview D1 metadata | BLOCKED | Account lookup failed before D1 access |
| Real Google OAuth | BLOCKED | Preview provider credentials not verified |
| Real email relay delivery | BLOCKED | Preview-only relay credential and delivery E2E not verified |
| Legacy Preview secret provenance | BLOCKED | Source/traffic ownership unresolved; no secret values read |
| Independent security review | BLOCKED | CodeMouse account subscription inactive; no independent review evidence |
| Production release | NOT AUTHORIZED | PR remains Draft; no merge or Production changes |

### Decision
**NOT READY FOR RELEASE.** Keep PR #96 Open / Draft. The latest exact-head automated CI and CodeQL are green, but live integration, Preview D1 metadata, legacy Worker provenance and independent review remain unresolved. Production remains untouched.


## Addendum — xác minh chính xác PR #96 và vòng đời session (11/11/2026)

### Commit và quan hệ PR
- Trước addendum này, PR #96 HEAD là `e2129f04fe8012c1ef348f1369537bb19a74287d`.
- Quan hệ nhánh đã xác minh qua GitHub REST:
  - PR #91: `fix/release-blockers-20261109` → `main`, base SHA `61c53cb8b2c74c69dbbe5afc114c83592bf43c67`.
  - PR #95: `security/pin-verified-actions-20261110` → `fix/release-blockers-20261109`, base SHA đúng bằng PR #91 HEAD `c5d17ab60f033ed9e7026522d28a7e2d100db12e`.
  - PR #96: `security/release-readiness-hardening-20261110` → `security/pin-verified-actions-20261110`, base SHA đúng bằng PR #95 HEAD `d86938debc516490cdd3ac2e8fc0ae9ddbd1fc74`.
- Cả ba PR vẫn Open / Draft; chưa PR nào được merge.

### Bổ sung regression test session
- Commit `e2129f04fe8012c1ef348f1369537bb19a74287d` chỉ sửa `scripts/test_community_api.mjs`, không sửa Worker runtime.
- Bổ sung assertion rằng logout:
  1. Xóa đúng server-side session row theo token hash.
  2. Cookie cũ không còn xác thực được qua `/me`.
- Bổ sung assertion rằng session có `expires_at` trong quá khứ bị `/me` từ chối.
- Static CI job `validate` trên SHA này hoàn tất SUCCESS; log xác nhận `node scripts/test_community_api.mjs` chạy qua và kết thúc với PASS.
- Đây là kiểm thử MockD1/offline, không phải thao tác hay kiểm thử ghi vào Preview/Production D1.

### CI exact-head trên SHA e2129f0
- GitHub trả về 10/10 check-runs completed / success trên commit này, bao gồm:
  - Static CI Quality Gate.
  - CodeQL Offline Security Analysis cho JavaScript/TypeScript, Python và GitHub Actions.
  - Staging Google OAuth integration.
  - Cloudflare Workers Builds Preview check.
- Có cả workflow push và pull_request cho một số workflow; không coi số lần chạy trùng là các bộ kiểm thử độc lập.
- Ba job CodeQL đều báo 0 findings trong SARIF cục bộ; không upload SARIF lên GitHub Code Scanning.
- Static CI ghi nhận: 69 bài viết đạt content quality gate; 74 trang HTML qua accessibility/performance; AI Bank 36 bản ghi (35 active) qua Chromium browser E2E; SEO consistency PASS; các regression guard cho login timing, relay allowlist, DNS rebinding và credential-free Preview PASS.
- OAuth integration CI ghi nhận 23/23 OIDC tests, 5/5 route runtime tests và 2/2 host allowlist tests PASS; migration rehearsal chỉ dùng in-memory SQLite.
- Những kết quả này chỉ áp dụng cho SHA `e2129f04fe8012c1ef348f1369537bb19a74287d`, không tự động chứng minh cho commit sau đó.

### Kiểm tra read-only stable Preview
- `/api/community/oauth/providers` hiện trả `{"google":true,"facebook":false}`.
- `/api/community/me` từ phiên truy cập không có cookie trả `{"member":null}`.
- `/api/community/messages?topic=tools` không có cookie bị từ chối HTTP 401.
- Provider flag chỉ xác nhận cấu hình được khai báo là hiện diện, không chứng minh token exchange thành công. Riêng người dùng đã báo cáo trước đó rằng đăng nhập Google thực tế trên trình duyệt Preview thành công, giữ session sau refresh và logout vẫn duy trì trạng thái đăng xuất sau refresh.
- Các request read-only hiện tại không mang cookie từ trình duyệt người dùng; không suy diễn trạng thái đăng nhập của người dùng từ `/me` anonymous.

### Blocker chưa đóng
- PR #91 còn 5 review threads chưa resolve. PR #96 chứa các mitigation cho bốn nhóm lỗi (PBKDF2 dummy work, fail-closed relay allowlist, DNS-pinned requests, credential-free Preview workflow), nhưng chưa có independent security review xác nhận trên final stack.
- Secret provenance và hoạt động của hai legacy Preview Workers vẫn chưa được xác minh; không đọc/rotate/delete secret hoặc thay binding.
- Cloudflare D1 read-only metadata/schema vẫn BLOCKED do thiếu `d1.read`; không truy cập Production D1.
- Branch protection chưa xác minh được vì GitHub integration trả 403. Rulesets API trả danh sách rỗng, nhưng điều này không thay thế việc xác minh branch protection.
- Independent security review vẫn BLOCKED; CodeQL offline không thay thế review độc lập.
- Hồ sơ audit này được cập nhật ở commit riêng sau SHA nêu trên; khi đánh giá gate phải lấy SHA mới nhất của PR #96 và chạy trạng thái checks tương ứng, không kế thừa PASS của SHA cũ.

### Quyết định
**NOT READY FOR RELEASE.** Giữ PR #91/#95/#96 ở Draft; không merge, deploy Production, apply D1 migration, đổi DNS hoặc chỉnh secret/binding. Chỉ tiếp tục kiểm tra read-only, offline CI và Preview tách biệt.


## Addendum — xác minh mới nhất sau bàn giao (11/11/2026, PR #96 HEAD `f9fc860bd739be0119accdcabd8681bd0344dcdf`)

### GitHub và CI exact-head
- PR #96 vẫn Open / Draft / chưa merge; branch `security/release-readiness-hardening-20261110`, base PR #95.
- PR #95 vẫn Open / Draft và base PR #91; PR #91 vẫn Open / Draft và base `main`. Không PR nào trong chuỗi đã merge.
- GitHub trả về 10/10 check-runs completed / success trên đúng HEAD `f9fc860bd739be0119accdcabd8681bd0344dcdf`. Các tên check gồm Workers Builds Preview, Static CI validate, hai nhóm CodeQL (Actions, JS/TS, Python) và hai lượt Staging Google OAuth integration. Các lượt trùng workflow không được tính thành các bộ kiểm thử độc lập.
- Static CI exact-head xác nhận: 69 bài viết được đưa vào static build/SEO feeds; 74 trang HTML qua accessibility/performance checks; AI Bank có 36 bản ghi (35 active) và Chromium E2E PASS; catalog E2E kiểm tra pagination, tìm kiếm, canonical IDs, sắp xếp, lọc review, noindex Preview và cách ly candidate.
- OAuth integration exact-head: OIDC 23/23 PASS; host allowlist 2/2 PASS; route runtime 7/7 PASS. Route runtime bao gồm Google OAuth start/callback/session, logout thu hồi server-side session và từ chối cookie cũ, cùng kiểm tra session hết hạn. Đây là kiểm thử mock/in-memory, không thay thế live OAuth.
- CodeQL: ba nhóm Actions, JavaScript/TypeScript và Python đều SUCCESS. Kết quả chỉ gắn với SHA trên.

### Cập nhật bằng chứng Google OAuth Preview thực tế
- Người dùng xác nhận ngày 11/11/2026 đã đăng nhập Google thành công trên hostname ổn định `ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev`; tải lại trang vẫn giữ phiên; đăng xuất rồi tải lại vẫn ở trạng thái chưa đăng nhập.
- Trước đó cùng phiên kiểm thử, endpoint OAuth providers trả `google:true, facebook:false` sau khi người dùng cập nhật OAuth Client ID/Client Secret Preview. Không có secret value nào được đọc hoặc ghi vào hồ sơ.
- Bằng chứng người dùng xác nhận này thay thế ghi chú cũ `google:false`/“real Google OAuth blocked” trong các snapshot trước. Trạng thái hiện tại: **Live Google OAuth Preview — PASS theo xác nhận E2E của người dùng**. Không được suy rộng sang Facebook hoặc Production.
- Server-side session revocation còn được kiểm tra riêng trong route-runtime mock test 7/7; không tuyên bố đã truy vấn trực tiếp hàng session trên Preview D1.

### Blocker còn lại
- **Preview D1 metadata/schema:** BLOCKED. Cloudflare API trước đó yêu cầu scope `d1.read`; kết nối hiện có gặp lỗi định dạng `X-Auth-Key`. Một yêu cầu tiếp theo trên đường dẫn metadata bị yêu cầu phê duyệt/đăng nhập và đã dừng. Không thử lại đường dẫn bị từ chối; không SQL, migration, D1 write hoặc truy cập Production D1.
- **Email relay delivery E2E:** NOT VERIFIED. Kiểm thử trước đây chỉ xác nhận logic/relay test mà không gửi email thật; chưa có bằng chứng mới về email đến test inbox. Không gửi email hoặc thay secret trong vòng kiểm tra này.
- **Legacy Preview Worker provenance:** BLOCKED. Hai Worker legacy còn binding metadata cần xác minh ownership, source/version và traffic. Không đọc, sao chép, rotate, xóa hoặc thay binding/secret.
- **Independent security review:** BLOCKED. CodeMouse account hiện subscription `inactive`; PR #96 không có review submission độc lập. Không mua gói, kích hoạt trial hoặc thiết lập thanh toán. CodeQL và tự rà soát source không được coi là independent review.
- **Branch protection:** NOT VERIFIED; quyền đọc endpoint bảo vệ branch/ruleset chưa đủ để kết luận cấu hình bảo vệ đã đạt yêu cầu.

### Hành động và giới hạn trong vòng này
- Đọc workflow job logs của exact-head OAuth và Static CI; xác minh 23/23 OIDC, 2/2 host allowlist, 7/7 route-runtime, catalog Chromium E2E, 69 bài viết, 74 trang accessibility/performance.
- Kiểm tra CodeMouse account status bằng thao tác read-only; trạng thái subscription là inactive.
- Kiểm tra HTTP GET công khai của stable Preview providers và /me chỉ cho kết quả HTTP 200 qua công cụ crawl; công cụ không trả response body JSON trong lượt đó. Không dùng điều này thay thế bằng chứng E2E do người dùng xác nhận.
- Không thay đổi ứng dụng, secrets, Worker, DNS, D1, dữ liệu người dùng, Production hoặc trạng thái merge/release.

### Quyết định cập nhật
**NOT READY FOR RELEASE.** Live Google OAuth Preview được nâng lên PASS theo xác nhận người dùng. Giữ PR #91/#95/#96 Open / Draft. Blocker quyết định còn lại là email relay delivery E2E, Preview D1 read-only metadata, provenance/traffic của legacy Preview Workers, independent security review và branch-protection verification. Không merge, không deploy Production, không migration, không đổi DNS/secret/binding.
