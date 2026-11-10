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
- **IPv6 regression coverage:** explicit offline cases now run in CI via `scripts/test_ipv6_address_safety.mjs` (added after the above run; its result will be recorded after the new CI run completes).
