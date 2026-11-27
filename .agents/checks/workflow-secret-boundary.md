---
files:
  - ".github/workflows/*.yml"
  - ".github/workflows/*.yaml"
---

# Secret trong GitHub Actions chỉ đến được từ `main` đáng tin cậy

Mọi job hoặc step nhận `${{ secrets.* }}` (token Cloudflare, credential staging, khóa API…) chỉ được chạy trên mã đã vào `main`. Không có đường nào để một branch, pull request hoặc fork khiến mã của chính nó chạy cùng secret. Ranh giới này đã được siết qua nhiều PR, gần nhất là [#378](https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/378) ([thảo luận review](https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/378#discussion_r4694112799)). `scripts/test_secret_workflow_dispatch_guards.mjs` cũng yêu cầu `deploy-auth-preview-candidate.yml` và `verify-auth-preview-candidate.yml` phải vắng mặt vì "branch-controlled workflows must not receive Cloudflare or application secrets".

## Vi phạm khi một job hoặc step dùng secret mà

- chạy được từ `pull_request`, `pull_request_target`, `push` lên branch khác `main`, hoặc `workflow_run` mà chỉ kiểm tra tên branch. Với `workflow_run`, consumer chỉ được tin producer khi đồng thời xác minh `github.event.workflow_run.event` là `push` hoặc `workflow_dispatch`, `github.event.workflow_run.head_repository.full_name == github.repository`, và `github.event.workflow_run.head_branch == 'main'`. Chấp nhận `workflow_dispatch` là cần thiết cho các deployment workflow được dispatch trực tiếp từ `main`; tuyệt đối không chấp nhận producer chạy từ `pull_request` hay fork, kể cả fork đặt tên branch là `main`. Nếu không thể chứng minh cả nguồn repo, loại event và branch đáng tin cậy, không chuyển SHA hoặc artifact của run đó sang job có secret;
- là `workflow_dispatch` nhưng thiếu điều kiện `github.ref == 'refs/heads/main'` trong `if:` của job hoặc của chính step mang secret;
- checkout một ref do người gọi kiểm soát (`github.head_ref`, input tự do, SHA của pull request) thay vì SHA bất biến của lần dispatch (`${{ github.sha }}`) hoặc `workflow_run.head_sha` đã được ràng buộc với trusted repository, trusted producer event và branch `main`. Không dùng tên branch mutable như `main` làm checkout ref khi cần chứng minh exact commit;
- tiêu thụ artifact từ một producer `workflow_run` chỉ vì metadata của producer đáng tin. `workflow_run.head_sha` xác định commit chạy workflow producer, không nhất thiết là commit nguồn được build: workflow dispatch từ `main` vẫn có thể checkout `inputs.source_ref` trỏ đến branch khác. Trước khi consumer có secret tải, giải nén, thực thi hoặc dùng artifact để quyết định thao tác có đặc quyền, phải chứng minh nguồn artifact chính xác là trusted commit bằng provenance/attestation ràng buộc artifact với source SHA và workflow identity; nếu không có bằng chứng đó, consumer phải tự checkout và build lại từ `workflow_run.head_sha` đáng tin cậy hoặc từ chối artifact. Không coi tên file, artifact name, run branch hay `workflow_run.head_sha` đơn lẻ là bằng chứng về source SHA của artifact;
- checkout mà không có `persist-credentials: false`;
- chèn trực tiếp `${{ inputs.* }}` hoặc dữ liệu sự kiện vào `run:` thay vì truyền qua `env:` rồi kiểm tra định dạng (như bước "Validate inputs and mask one-time tokens" trong `staging-email-e2e.yml`);
- dùng action không ghim theo SHA đầy đủ 40 ký tự;
- mở rộng `permissions:` vượt quá mức job cần (mặc định `contents: read`).

Workflow mới hoặc job mới nhận secret của tài khoản thật (staging, Preview, Production) cũng cần gắn `environment:` có deployment branch policy chỉ cho phép `main`, vì điều kiện `if:` nằm trong tệp workflow và người có quyền ghi có thể xóa nó trên branch khác rồi dispatch, như đã nêu ở #378. Secret của tài khoản thật chỉ được lưu dưới dạng environment secret trong environment tương ứng; không lưu cùng tên dưới repository secret hoặc organization secret, vì job bỏ khóa `environment:` vẫn có thể đọc secret cấp repository/organization. Khi thêm hoặc đổi một workflow mang secret, cần thêm hoặc cập nhật assertion tương ứng trong `scripts/test_secret_workflow_dispatch_guards.mjs`. Quy tắc lưu trữ này áp dụng cho workflow/job mới; không tự ý thay đổi các workflow triển khai hiện hữu trong phạm vi check tài liệu này.

Lý do: secret ở đây cho phép triển khai Production Worker, đọc/ghi D1 hoặc đăng nhập tài khoản staging; lộ qua một branch là sự cố không thể đảo ngược.

## Ví dụ

Sai: dispatch được từ bất kỳ branch nào, checkout ref do người gọi chọn và giữ token checkout:

```yaml
on:
  workflow_dispatch:
    inputs:
      ref: { type: string }
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref }}
      - run: node scripts/test-live-staging-email-e2e.mjs
        env:
          STAGING_E2E_PASSWORD: ${{ secrets.STAGING_E2E_PASSWORD }}
```

Đúng (theo `staging-email-e2e.yml`):

```yaml
jobs:
  staging-email-e2e:
    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'
    environment: staging-e2e
    runs-on: ubuntu-latest
    steps:
      - name: Check out the exact trusted dispatch commit
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: ${{ github.sha }}
          persist-credentials: false
```

Đối với consumer dùng `workflow_run`, kiểm tra `workflow_run.event` thuộc `push` hoặc `workflow_dispatch`, `workflow_run.head_repository.full_name` bằng repository hiện tại, và `workflow_run.head_branch` là `main`; sau đó checkout đúng `github.event.workflow_run.head_sha`. Nếu cần artifact, bắt buộc xác minh provenance liên kết artifact với source SHA; nếu không thể xác minh, build lại từ trusted SHA hoặc từ chối artifact. Không checkout branch name hoặc artifact không rõ nguồn.
