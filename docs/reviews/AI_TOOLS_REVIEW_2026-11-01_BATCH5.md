# AI TOOLS REVIEW — BATCH 5
**Ngày rà soát:** 01/11/2026 (ICT)  
**Nhánh:** `catalog/review-batch5-15-tools-20261101`  
**Trạng thái:** candidate-only / chưa đưa vào catalog chính

## Phạm vi
15 ứng viên được chọn để mở rộng các nhóm observability, model gateway, visual workflow, local inference, OCR, document ETL, speech transcription và AI coding. Đã đối chiếu ID/tên với catalog chính 12 entries, batch 3 (15 entries) và batch 4 (15 entries); không chọn trùng tên/ID.

| Công cụ | Nhóm | Bằng chứng sơ bộ / rủi ro cần kiểm tra |
|---|---|---|
| Langfuse | LLM observability | MIT OSS; self-host core miễn phí; Cloud Hobby 50k units/tháng, 2 users; Enterprise riêng. |
| LiteLLM | AI gateway | MIT OSS SDK/gateway; enterprise directory và enterprise terms riêng; model provider tính token độc lập. |
| Dify | LLM app builder | Dify Open Source License là Apache-2.0 có điều kiện bổ sung, đặc biệt multi-tenant và giữ branding; Sandbox 200 message credits. |
| Flowise | Visual agent/workflow | Apache-2.0 source; tự host được; Cloud pricing/limits cần kiểm tra riêng. |
| Ollama | Local model runtime | MIT software; local run free; Cloud có pay-as-you-go và Pro/Max/Team; model weights có license riêng. |
| OpenRouter | Hosted model gateway | Free tier 25+ models, 4 providers, 50 requests/day; free model variants có giới hạn; paid inference và platform fee riêng. |
| Tesseract OCR | OCR engine | Apache-2.0 source; Leptonica và traineddata/dependencies cần rà soát riêng. |
| EasyOCR | OCR library | Apache-2.0 code; model hub có checkpoint tải xuống nhưng chưa thấy license rõ ràng cho từng weight artifact — `needs_review`. |
| Surya OCR | Document OCR/layout | Apache-2.0 code; model weights modified Open Rail-M: ngưỡng doanh thu/tài trợ trên US$5M và hạn chế cạnh tranh với Datalab; hosted API có allowance riêng. |
| Unstructured | Document ETL | Apache-2.0 open-source library; hosted API có 10k free pages ban đầu rồi $0.015/page. |
| Marker | PDF-to-Markdown | Apache-2.0 code; model weights modified Open Rail-M: ngưỡng doanh thu/tài trợ trên US$5M và hạn chế cạnh tranh với Datalab; hosted API có allowance riêng. |
| WhisperX | Speech transcription | BSD-2-Clause code; pyannote community-1 CC-BY-4.0 và gated HF access; Whisper MIT, wav2vec2 model được dẫn Apache-2.0, Silero VAD MIT; aligner/model variants cần kiểm tra theo phiên bản. |
| OpenHands | AI coding agent | MIT open-source app; Cloud Individual free/BYOK hoặc at-cost models; Enterprise backend license khác. |
| Aider | AI pair programming | Apache-2.0 CLI; chi phí model/API do provider tính. |
| Hugging Face Hub | Model/dataset hub | Free tier có rate limits theo API/resolver/page; quotas thay đổi theo plan và platform health; mỗi model/dataset có license riêng. |

## Nguồn chính thức đã thu thập
- Langfuse: https://langfuse.com/pricing ; https://langfuse.com/pricing-self-host ; https://langfuse.com/self-hosting
- LiteLLM: https://docs.litellm.ai/ ; https://github.com/BerriAI/litellm ; https://github.com/BerriAI/litellm/blob/main/enterprise/LICENSE.md
- Dify: https://www.dify.ai/pricing ; https://github.com/langgenius/dify/blob/main/LICENSE
- Flowise: https://github.com/FlowiseAI/Flowise ; https://docs.flowiseai.com/
- Ollama: https://ollama.com/pricing ; https://github.com/ollama/ollama/blob/main/LICENSE
- OpenRouter: https://openrouter.ai/pricing ; https://openrouter.ai/collections/free-models
- Tesseract: https://github.com/tesseract-ocr/tesseract ; https://tesseract-ocr.github.io/tessdoc/
- EasyOCR: https://github.com/JaidedAI/EasyOCR ; https://github.com/JaidedAI/EasyOCR/blob/master/LICENSE
- Surya: https://github.com/datalab-to/surya ; https://github.com/datalab-to/surya/blob/master/README.md ; https://github.com/datalab-to/surya/blob/master/pyproject.toml
- Unstructured: https://github.com/Unstructured-IO/unstructured ; https://github.com/Unstructured-IO/unstructured/blob/main/pyproject.toml ; https://github.com/Unstructured-IO/unstructured/blob/main/LICENSE.md ; https://unstructured.io/pricing
- Marker: https://github.com/datalab-to/marker ; https://github.com/datalab-to/marker/blob/master/README.md ; https://github.com/datalab-to/marker/blob/master/LICENSE ; https://github.com/datalab-to/marker/blob/master/MODEL_LICENSE ; https://www.datalab.to/pricing
- WhisperX: https://github.com/m-bain/whisperX ; https://github.com/m-bain/whisperX/blob/main/LICENSE ; https://pypi.org/project/whisperx/
- OpenHands: https://github.com/OpenHands/OpenHands ; https://github.com/OpenHands/OpenHands/blob/main/LICENSE ; https://www.openhands.dev/pricing ; https://github.com/OpenHands/enterprise
- Aider: https://aider.chat/ ; https://github.com/Aider-AI/aider ; https://github.com/Aider-AI/aider/blob/main/LICENSE.txt
- Hugging Face Hub: https://huggingface.co/pricing ; https://huggingface.co/docs/hub/rate-limits

## Cổng kiểm soát
- Trạng thái xác minh hiện tại: 13/15 `verified` trong phạm vi source/app/license/pricing đã mô tả; EasyOCR và Hugging Face Hub vẫn `needs_review` (license checkpoint EasyOCR chưa rõ; quota Hugging Face Free/anonymous biến động). Toàn bộ 15 vẫn ở khu vực candidate-only và chờ phê duyệt biên tập trước khi chuyển vào catalog chính.
- Đã tạo validator riêng để kiểm tra 15 entries, trường bắt buộc, enum, HTTPS sources, ngày kiểm tra, duplicate ID/tên trong batch và trùng với catalog chính + batch 3 + batch 4.
- Chưa đưa dữ liệu vào `site-snapshot/data/ai-tools.json`; chưa merge, deploy hoặc publish.
- Chưa tạo tài khoản, trial, API key, nạp credits hoặc phát sinh chi phí.
- GitLab CI quota hết: sử dụng CircleCI fallback trên đúng SHA. CircleCI pass là yêu cầu trước khi xem xét MR, không thay thế kiểm tra biên tập/pháp lý và không tự động xác minh nội dung web.


## CircleCI fallback
- Nhánh batch 5 được bổ sung `.circleci/config.yml` riêng, dùng Node.js 22 và chạy `scripts/validate-ai-tools-batch5.mjs`.
- Validator so sánh batch 5 với catalog chính và ID/tên đã biết của batch 3, batch 4; không cần checkout các nhánh candidate khác.
- API trigger thủ công của CircleCI trả HTTP 400 vì loại kết nối GitLab project này chưa hỗ trợ API trigger. Vì vậy luồng dự kiến là GitLab push webhook tự kích hoạt CircleCI sau khi config có trong branch; cần xác minh pipeline thực tế trước khi báo pass.
- Không coi việc tạo config hoặc trigger thất bại là kiểm thử thành công.


## Merge Request và CI xác nhận — 01/11/2026
- MR !67: https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/merge_requests/67 — Draft, target `staging/auth-worker-build`, không conflict.
- CircleCI workflow #58 đã SUCCESS trên SHA `520f7d9217e9329a5dd0b42b7eb2b447ee75bb85`.
- GitLab MR pipeline #1392 trên cùng SHA: cả `migration-validation` và `javascript-validation` đều kết thúc `ci_quota_exceeded`, `started_at=null`; không có runner job nào thực thi.
- Vì GitLab quota blocker, CircleCI #58 là kết quả kiểm thử thực thi duy nhất đã xác minh cho batch 5 ở SHA này. Không coi GitLab quota error là code test failure.


## Kết quả kiểm chứng vòng 1 — 01/11/2026
### Đã xác minh trong phạm vi ghi rõ (13/15)
- **Langfuse:** OSS self-host MIT, core features không giới hạn; Cloud Hobby free no-card, 50k units/month, 2 users, 30-day data access. Enterprise riêng.
- **LiteLLM:** pyproject chính thức xác nhận MIT; enterprise/ folder có license riêng và yêu cầu license production. Model provider costs tách biệt.
- **Dify:** license là modified Apache-2.0 với điều kiện multi-tenant/branding; Sandbox có 200 message credits, 1 workspace/member, 5 apps, 50 knowledge docs và 50MB storage.
- **Flowise:** source Apache-2.0; npm self-host path được mô tả trong README; Cloud pricing chưa xác minh nên chỉ xác nhận self-host source.
- **Ollama:** phần mềm MIT; pricing page hiện ghi Free $0, Pro $20/month, Max $100/month (new sign-ups paused), Team $25/seat/month, tối thiểu 5 seats. Model weights có license riêng.
- **OpenRouter:** pricing page ghi 25+ free models và 4 free providers; free variants có rate limits riêng, paid token usage và platform fee được tách biệt.
- **Tesseract:** source Apache-2.0; README xác nhận Leptonica BSD-2-Clause và dependencies khác có thể dùng license khác.
- **Aider:** repository/CLI Apache-2.0; đã đọc trực tiếp `LICENSE.txt` upstream. Chi phí inference do model/provider tính riêng.
- **Surya:** source Apache-2.0; model weights modified AI Pubs Open Rail-M. License cấm sử dụng nếu đơn vị liên quan có doanh thu năm trước trên US$5M hoặc đã huy động tổng equity/debt funding trên US$5M, trừ mục đích cá nhân/nghiên cứu; đồng thời cấm sử dụng cho tổ chức cung cấp sản phẩm/dịch vụ cạnh tranh với Datalab hoặc affiliate. License thương mại/rộng hơn có thể được cấp riêng.
- **Unstructured:** core library Apache-2.0/free; hosted API 10.000 free pages rồi $0.015/page.
- **Marker:** code Apache-2.0; model weights modified AI Pubs Open Rail-M với cùng điều khoản ngưỡng doanh thu/tài trợ và hạn chế cạnh tranh nêu trên; không suy ra quyền sử dụng weights từ license code.
- **WhisperX:** repository BSD-2-Clause; Whisper/diarization/alignment model licenses tách riêng.
- **OpenHands:** open-source Agent Canvas MIT; Enterprise backend license riêng, Cloud Individual free tier có BYOK hoặc model at-cost.
### Còn needs_review (2/15)
- **EasyOCR:** package/repository Apache-2.0 nhưng license cho từng pretrained checkpoint chưa được nêu rõ; không suy rộng license code sang model weights.
- **Hugging Face Hub:** trang rate-limit chính thức vẫn ghi bảng tier tham chiếu tháng 9/2025; quota Free/anonymous thay đổi theo platform health, nên chưa thể xác nhận hạn mức hiện hành.
- Các mục verified là xác minh phạm vi source/app/license và pricing ghi rõ, không có nghĩa model weights/dependencies của mọi công cụ đã được audit đầy đủ.


## LỊCH SỬ — Cập nhật trạng thái cuối vòng 1 (đã bị thay thế bởi audit model weights phía dưới) — 01/11/2026
- 13/15 công cụ được đánh dấu `verified` trong phạm vi code/app/license/pricing đã mô tả; 2/15 giữ `needs_review` (Aider và Hugging Face Hub).
- Validator batch 5 đã được sửa lỗi cú pháp line-break và chạy qua CircleCI workflow #61: **SUCCESS** trên SHA `206d02b68735659ac86528b8d7140ea25a9ea22f`.
- GitLab MR pipeline #1395 trên cùng SHA tiếp tục bị chặn trước runner bởi `ci_quota_exceeded`; cả hai job có `started_at=null`.
- MR !67 vẫn Draft, không conflict; catalog chính chưa thay đổi.


## CI xác nhận trên HEAD cuối vòng 1 — 01/11/2026
- CircleCI workflow #62: **SUCCESS** trên SHA `442800bd4ac6d5365efd29ba3d9dffa7852958e4`. [Mở CircleCI run #62](https://app.circleci.com/pipelines/circleci/Kd4KJwCHeWMBtZFaf5QkZt/U3U1HnVo72MN7DYojq4TvY/62).
- GitLab MR pipeline #1396 trên cùng SHA: hai job dừng trước runner do `ci_quota_exceeded` (`started_at=null`).
- MR !67 vẫn Draft, không conflict; 13 verified / 2 needs_review; catalog chính chưa thay đổi.


## LỊCH SỬ — Kết quả kiểm chứng vòng 2 (số liệu 14/15 đã bị thay thế; xem audit model weights phía dưới) — 01/11/2026
- **Aider: VERIFIED.** Đã đọc trực tiếp tệp `LICENSE.txt` trên repository upstream `Aider-AI/aider`; nội dung là Apache License, Version 2.0. Trang repository cũng gắn nhãn Apache-2.0. Phạm vi xác minh là mã nguồn/dự án Aider; chi phí inference vẫn do model/provider được chọn tính riêng.
- **Hugging Face Hub: NEEDS_REVIEW.** Tài liệu chính thức chia rate limits thành Hub APIs, Resolvers và Pages, tính theo cửa sổ 5 phút; bảng quota hiển thị vẫn có mốc September 2025 và ghi quota Free/anonymous có thể thay đổi theo platform health. Không công bố một hạn mức cố định hiện hành trong hồ sơ.
- Trạng thái batch 5 được cập nhật thành **14/15 verified, 1/15 needs_review**. Candidate-only; chưa thêm vào catalog chính.
- Nguồn Aider: https://github.com/Aider-AI/aider/blob/main/LICENSE.txt
- Nguồn Hugging Face: https://huggingface.co/docs/hub/rate-limits


## CI xác nhận vòng 2 — CircleCI pipeline #64
- CircleCI project `ai-thuc-chien-blog-test` nhận webhook push từ GitLab cho branch `catalog/review-batch5-15-tools-20261101`.
- Pipeline #64 checkout đúng SHA `bfac225ce81ea14ebed9b15e599c813559f457fc`; workflow `circleci_fallback_batch5` có trạng thái **success**.
- Config của branch chỉ định một job `candidate-batch5-validation`, chạy Node.js 22 và `node scripts/validate-ai-tools-batch5.mjs`. Workflow success xác nhận validator chạy qua trên SHA nêu trên.
- GitLab MR pipeline #1399 trên cùng SHA bị quota blocker: hai job đều `started_at=null`, `failure_reason=ci_quota_exceeded`. Không coi đây là lỗi mã nguồn.
- CircleCI #64 URL: https://app.circleci.com/pipelines/circleci/Kd4KJwCHeWMBtZFaf5QkZt/U3U1HnVo72MN7DYojq4TvY/64


## Cập nhật validator và CI fallback — 01/11/2026
- Đã tăng cường `scripts/validate-ai-tools-batch5.mjs`: kiểm tra kiểu và nội dung không rỗng của các trường bắt buộc; kiểm tra mảng categories/platforms/sources/tags; phân tích URL bằng `URL` và chỉ chấp nhận HTTPS không có thông tin xác thực; xác thực ngày theo lịch thực tế thay vì chỉ dùng Date.parse.
- Commit validator: `005590a245619f73e4c6ee9d28a203cb38f84fff`.
- CircleCI pipeline #74 / workflow `circleci_fallback_batch5`: **SUCCESS** trên đúng checkout SHA `005590a245619f73e4c6ee9d28a203cb38f84fff`. Đây là kiểm thử validator trên commit mới, không phải phê duyệt nội dung hay cấp phép đưa candidate vào catalog chính.
- GitLab MR pipeline #1419: hai job đều bị `ci_quota_exceeded` trước khi runner khởi chạy (`started_at=null`). CircleCI là bằng chứng thực thi kiểm thử cho SHA này.
- MR !67 vẫn Draft, candidate-only; 14/15 verified trong phạm vi nêu trên, Hugging Face Hub tiếp tục `needs_review`. Catalog chính chưa thay đổi.


## Kiểm tra reachability nguồn chính thức — 01/11/2026
- Đã kiểm tra 68 URL nguồn duy nhất trong hồ sơ batch 5 bằng cách tải trực tiếp trang đích và xác nhận tiêu đề/trạng thái trang.
- Phát hiện 2 đường dẫn không còn hợp lệ: LiteLLM enterprise license dùng nhánh cũ và Aider trỏ sai tên tệp license. Đã thay bằng đường dẫn hiện hành:
  - https://github.com/BerriAI/litellm/blob/main/enterprise/LICENSE.md
  - https://github.com/Aider-AI/aider/blob/main/LICENSE.txt
- Bổ sung nguồn license tách biệt còn thiếu cho Marker (code LICENSE và MODEL_LICENSE), Unstructured (LICENSE.md), OpenHands (LICENSE).
- Sau cập nhật: 72/72 URL duy nhất đã được xác nhận truy cập được trong lần kiểm tra này. Đây là kiểm tra reachability và tiêu đề/trích xuất nội dung, không thay thế đánh giá pháp lý hoặc audit mọi model weight/dependency.
- Candidate-only vẫn giữ nguyên; không chuyển 14 công cụ vào catalog chính, không publish.


## Cập nhật điều khoản model weights và Datalab pricing — 01/11/2026
- Đọc trực tiếp `MODEL_LICENSE` của Marker và Surya. Ngoài điều kiện doanh thu năm trước trên US$5M hoặc tổng equity/debt funding trên US$5M (ngoại lệ cá nhân/nghiên cứu), Attachment A còn cấm sử dụng cho bất kỳ mục đích nào bởi tổ chức cung cấp sản phẩm/dịch vụ cạnh tranh với Datalab hoặc affiliate. Điều khoản này áp dụng cho model weights, không thay thế license Apache-2.0 của code.
- Datalab pricing hiện liệt kê hosted API allowance US$20/tháng với work email hoặc US$10/tháng với personal email, sau đó pay-as-you-go; Team US$400/tháng. Đây là dịch vụ hosted riêng, không đồng nghĩa model weights được dùng không hạn chế.
- Unstructured pricing hiện xác nhận 10.000 free pages ban đầu, sau đó US$0.015/page; Business deployment báo giá riêng.
- Candidate JSON đã được cập nhật để tách bạch code license, model-weight license và hosted API pricing.


## Audit model weights và quyền truy cập — 01/11/2026
- **EasyOCR: NEEDS_REVIEW.** Trang Model Hub chính thức liệt kê checkpoint theo ngôn ngữ và cung cấp liên kết tải xuống; README xác nhận weights được tải tự động hoặc tải thủ công. Tuy nhiên, trang Model Hub và các nguồn được rà soát chưa nêu license rõ ràng cho từng checkpoint. Apache-2.0 của repository/package không đủ căn cứ để kết luận mọi pretrained weights và dữ liệu huấn luyện đều có cùng license. Giữ trạng thái `needs_review` cho tới khi xác minh được từng artifact cần dùng.
- **WhisperX: VERIFIED trong phạm vi các thành phần được dẫn.** Đã chuẩn hóa nguồn về upstream `m-bain/whisperX` (BSD-2-Clause). README upstream xác nhận diarization dùng `pyannote/speaker-diarization-community-1`, license CC-BY-4.0, yêu cầu chấp nhận điều kiện truy cập và HF token. OpenAI Whisper công bố code và model weights MIT; model card `facebook/wav2vec2-large-960h` ghi Apache-2.0; Silero VAD công bố MIT. Không suy rộng các license này sang mọi model alignment/ngôn ngữ hoặc dependency khác; cần kiểm tra model ID và version thực tế trước khi đóng gói/phân phối.
- Nguồn bổ sung: https://www.jaided.ai/easyocr/modelhub/ ; https://github.com/m-bain/whisperX ; https://huggingface.co/pyannote/speaker-diarization-community-1 ; https://github.com/openai/whisper ; https://huggingface.co/facebook/wav2vec2-large-960h ; https://github.com/snakers4/silero-vad
- Trạng thái mới nhất: **13/15 verified, 2/15 needs_review** (EasyOCR và Hugging Face Hub). Các kết quả cũ hơn trong lịch sử báo cáo được giữ để truy vết; cập nhật này là trạng thái mới nhất và thay thế số liệu trước đó.
- Candidate-only; chưa chuyển bất kỳ công cụ nào vào catalog chính, chưa merge/deploy/publish và không phát sinh chi phí.


## Xác minh lại Dify repository, license và Sandbox — 01/11/2026
- Repository upstream hiện được tham chiếu là `alibaba/dify`; đã thay các URL repository cũ `langgenius/dify` trong hồ sơ candidate bằng URL chính thức hiện hành và trỏ trực tiếp tới LICENSE.
- LICENSE hiện tại mô tả Dify Open Source License dựa trên Apache-2.0 với hai điều kiện bổ sung quan trọng: không được vận hành multi-tenant environment (mỗi workspace là một tenant) nếu chưa có văn bản cho phép; không được xóa/sửa logo hoặc thông tin copyright trong frontend Dify nếu chưa có commercial license.
- Dify Cloud Sandbox: Free; 200 message credits, 1 workspace, 1 member, 5 apps, 50 knowledge documents, 50MB storage, 10 knowledge requests/min và 3.000 trigger events. Credits dùng để thử model providers; sau khi hết có thể chuyển sang API key riêng, vì vậy model API có thể phát sinh chi phí ngoài gói Dify.
- Kết luận: trạng thái Dify `verified` giữ nguyên trong phạm vi license/pricing nêu trên; nguồn chính thức đã được cập nhật. Đây không phải tư vấn pháp lý hay xác nhận quyền phân phối mọi plugin/model tích hợp.
- Nguồn: https://github.com/alibaba/dify/blob/main/LICENSE ; https://www.dify.ai/pricing ; https://docs.dify.ai/ .
- Batch 5 vẫn candidate-only; không sửa catalog chính.


## Xác minh lại cấu trúc repository và giấy phép OpenHands — 01/11/2026
- Upstream hiện phân tách rõ nhiều repository: `OpenHands/OpenHands` sở hữu Agent Canvas frontend và local-stack orchestration; `OpenHands/software-agent-sdk` sở hữu Python SDK, Agent Server, agents, tools, workspaces và server API; `OpenHands/automation` sở hữu scheduling/webhooks/dispatch. Hai repository OSS chính được dẫn đều công bố MIT.
- Repository riêng `OpenHands/enterprise` là backend source-available, không phải OSS; LICENSE là PolyForm Free Trial 1.0.0, giới hạn sử dụng tối đa 30 ngày mỗi năm nếu chưa có commercial license. Không được mô tả toàn bộ OpenHands như một codebase MIT duy nhất.
- Pricing chính thức phân biệt Local Open Source Free, Cloud Individual Free (10 conversations/day; BYOK hoặc model provider tính at-cost), và Enterprise custom pricing. Mức “free” không có nghĩa LLM inference miễn phí.
- Đã bổ sung nguồn LICENSE chính thức của `software-agent-sdk` và cập nhật mô tả license/pricing trong candidate JSON. Trạng thái `verified` giữ nguyên trong phạm vi các repo/plan được dẫn.
- Nguồn: https://github.com/OpenHands/OpenHands ; https://github.com/OpenHands/software-agent-sdk ; https://github.com/OpenHands/enterprise/blob/main/LICENSE ; https://www.openhands.dev/pricing .
- Candidate-only; chưa sửa catalog chính hoặc triển khai dịch vụ.


## Trạng thái tổng hợp hiện hành — 01/11/2026
- **13/15 verified:** Langfuse, LiteLLM, Dify, Flowise, Ollama, OpenRouter, Tesseract OCR, Surya OCR, Unstructured, Marker, WhisperX, OpenHands và Aider.
- **2/15 needs_review:** EasyOCR (license cho từng pretrained checkpoint chưa rõ) và Hugging Face Hub (quota Free/anonymous biến động, tài liệu quota có mốc dữ liệu cũ).
- CircleCI pipeline #91 / workflow `circleci_fallback_batch5`: **SUCCESS** trên đúng HEAD `89f243adb6bd6065864e936f3091b3a3e52c7c6f`.
- GitLab MR pipeline #1453 trên cùng SHA bị `ci_quota_exceeded`; hai job không khởi chạy runner (`started_at=null`). Đây là quota blocker, không phải kết quả test thất bại.
- Toàn bộ 15 ứng viên vẫn candidate-only. Không có công cụ nào được chuyển vào catalog chính; chưa merge, deploy hoặc publish.


## Phê duyệt biên tập và đưa Batch 5 vào catalog staging — 01/11/2026
- Theo lựa chọn phát hành cả hai MR của chủ dự án, 15 hồ sơ Batch 5 đã được thêm vào `site-snapshot/data/ai-tools.json` trên nhánh MR !67 để kiểm thử staging; catalog tăng từ 12 lên 27 records, không có ID/tên trùng.
- Giữ nguyên trạng thái xác minh: **13 verified** và **2 needs_review** (EasyOCR, Hugging Face Hub). Hai hồ sơ needs_review hiển thị đúng nhãn cảnh báo; việc có mặt trong catalog không được hiểu là đã giải quyết rủi ro license/quota.
- Candidate JSON và báo cáo review vẫn được giữ để truy vết nguồn và lịch sử. Các ghi chú cũ nói “candidate-only/chưa đưa vào catalog” mô tả trạng thái trước commit này và được thay thế bởi cập nhật hiện hành.
- Đây mới là thay đổi trên nhánh staging của MR !67; chưa merge vào nhánh staging đích, chưa deploy production, chưa công khai lên website chính.
- Kiểm tra tiếp theo bắt buộc: validator batch 5, UI/data contract, preview chính xác commit mới, xác nhận catalog 27 records và hai trạng thái needs_review; kiểm thử browser E2E vẫn là cổng riêng.


## Dọn hàng chờ review cũ sau khi promote Batch 5 — 01/11/2026
- Đã loại khỏi hàng chờ ngày 31/10 bốn hồ sơ đã được đưa vào catalog chính hoặc được thay bằng hồ sơ Batch 5 trùng sản phẩm: Ollama, Dify, OpenRouter và Hugging Face.
- Giữ `whisper.cpp` trong hàng chờ vì chỉ trùng domain GitHub với các dự án khác, không phải cùng sản phẩm. Audit nay phân biệt trùng ID/tên/tên+vendor (strict blocker) với trùng domain đơn thuần (cảnh báo để con người xem xét).
- Việc này giữ nguyên các ứng viên còn lại; không tự xác minh hay nâng trạng thái license/quota.
