# Rà soát Ngân hàng AI — đợt bổ sung 2 (31/10/2026)

## Phạm vi
- Repo: `manhdungub/ai-thuc-chien-blog`
- Nhánh: `staging/auth-worker-build`
- HEAD trước khi ghi: `ad082ce3436cb30c89891fb31fefdc7be71b2596`
- Catalog chính: 12 bản ghi; 12/12 đang `needs_review`.
- So khớp ứng viên với 12 tên, nhà cung cấp và domain hiện có: không trùng chính xác.

## Kết quả đợt này
| Chỉ số | Kết quả |
|---|---:|
| Ứng viên mới thêm vào hàng chờ | 5 |
| Bản ghi catalog chính được cập nhật | 0 |
| Link hỏng được xác nhận | 0 |
| Link đã kiểm tra bằng HTTP checker | Chưa chạy |
| Giá/hạn mức cần biên tập xác minh | 5/5 |
| Trùng với 12 bản ghi catalog chính | 0 |

Không kết luận các URL còn hoạt động chỉ từ việc trang nguồn mở được trong trình duyệt tìm kiếm; chưa chạy HTTP checker toàn danh mục.

## Ứng viên và bằng chứng nguồn chính thức
1. **LiteLLM** — gateway/SDK đa nhà cung cấp. Trang giá chính thức nói OSS tự lưu trữ $0 lâu dài, Enterprise có phí; pyproject của repository khai báo MIT. Enterprise có trial 30 ngày, không phải gói miễn phí thường trực. Nguồn: https://www.litellm.ai/pricing ; https://docs.litellm.ai/ ; https://github.com/BerriAI/litellm/blob/main/pyproject.toml
2. **Langfuse** — LLM observability/evaluation. Trang self-host ghi core OSS miễn phí, MIT; self-hosting docs lưu ý một số add-on cần license key; cloud có Hobby miễn phí và các gói trả phí. Nguồn: https://langfuse.com/pricing-self-host ; https://langfuse.com/self-hosting ; https://langfuse.com/pricing ; https://github.com/langfuse/langfuse
3. **OpenHands** — coding agent. Trang giá ghi local open source Free; Cloud Individual Free có tối đa 10 hội thoại/ngày và dùng provider at-cost/BYOK; Enterprise custom pricing. FAQ nói bản OSS MIT. Nguồn: https://www.openhands.dev/pricing ; https://docs.openhands.dev/ ; https://github.com/OpenHands/OpenHands/blob/main/LICENSE
4. **RAGFlow** — RAG/document AI và agent. Trang cloud ghi Free: 5 apps, 1 thành viên, 0.1 GB, 500 credits/tháng; Starter/Pro trả phí. Repository hiển thị Apache-2.0. Self-host có yêu cầu hạ tầng cao, gồm RAM tối thiểu 16 GB. Nguồn: https://ragflow.io/ ; https://github.com/infiniflow/ragflow ; https://github.com/infiniflow/ragflow/blob/main/LICENSE
5. **LangGraph** — framework điều phối agent. Trang chính thức nói LangGraph là MIT-licensed và miễn phí; phân biệt LangGraph framework với LangSmith platform có tính năng/dịch vụ thương mại riêng. Nguồn: https://www.langchain.com/langgraph ; https://docs.langchain.com/oss/python/langgraph/overview ; https://github.com/langchain-ai/langgraph/blob/main/LICENSE

## Loại khỏi ứng viên
- **Continue.dev:** GitHub repository chính thức hiện ghi codebase read-only/không còn được duy trì tích cực và phát hành cuối 2.0.0; không thêm vào nhóm công cụ đang hoạt động. Nguồn: https://github.com/continuedev/continue

## Hạn chế và việc cần biên tập
- 5 hồ sơ đều gắn `verification_status=needs_review`, `pricing_status=unknown`; không tự đánh dấu verified.
- Xác minh lại hạn mức Cloud theo khu vực Việt Nam, thuế/đơn vị tiền tệ và điều khoản BYOK trước khi đổi sang trạng thái xác minh.
- Kiểm tra license cụ thể của các thành phần/enterprise folders, không suy rộng license core sang dịch vụ hosted.
- Kiểm tra link bằng HTTP GET có rate limit ở đợt riêng.
- Chưa nhập vào catalog chính, chưa merge, deploy hoặc xuất bản.

## An toàn
Chỉ tạo tệp candidate và báo cáo trên staging. Không sửa catalog chính, D1, production, không merge/deploy, không mua gói hoặc tạo chi phí.


## Kiểm tra chất lượng bổ sung sau khi lưu báo cáo
- Phát hiện validator trước đó lặp chuỗi literal `"website"` thay vì lấy `tool.website`, khiến kiểm tra URL báo lỗi giả cho tất cả bản ghi. Đã sửa tại commit `dcedf178`.
- Đã chạy logic validator với dữ liệu JSON được nạp qua harness mô phỏng Node APIs: catalog chính 12/12 bản ghi cấu trúc hợp lệ, không có lỗi; có 12 cảnh báo pricing do bản ghi chưa verified.
- Candidate batch 1: 7/7 bản ghi cấu trúc hợp lệ, không có lỗi; 2 cảnh báo pricing cần biên tập.
- Candidate batch 2: 5/5 bản ghi cấu trúc hợp lệ, không có lỗi/cảnh báo.
- UI contract test được thực thi bằng harness với các file nguồn đã lấy từ GitLab và đạt các assertion về JSON endpoint, controls, pagination và static asset binding.
- Các kiểm tra trên là kiểm tra logic/mã với dữ liệu đã lấy; **không phải** một lần chạy Node.js thật trên máy chủ, không phải GitLab CI và không phải kiểm thử trình duyệt. CI tiếp tục được bỏ qua bằng `[skip ci]`.
- URL được kiểm tra định dạng và cấu trúc, chưa chạy HTTP GET cho từng link; do đó số link hỏng vẫn là **chưa xác định**, không phải 0.
- Cloudflare deployment staging mới nhất vẫn là phiên bản ngày 29/10/2026; các commit 31/10 chưa được triển khai.
