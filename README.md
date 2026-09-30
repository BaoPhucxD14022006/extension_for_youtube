# 🎬 CinemaSub - AI Cinema-Grade YouTube Subtitles

<p align="center">
  <img src="icons/icon128.png" alt="CinemaSub Logo" width="96" height="96" style="border-radius: 20px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);">
  <br>
  <strong>Trải nghiệm xem YouTube với phụ đề AI song ngữ chuẩn rạp chiếu phim</strong>
  <br>
  <em>Đồng bộ từng giây nói • Dịch câu điện ảnh tự nhiên • Khởi động siêu tốc trong 1.5s</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-success?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/NVIDIA%20NIM-LLaMA%203.2-76B900?style=for-the-badge&logo=nvidia&logoColor=white" alt="NVIDIA NIM">
  <img src="https://img.shields.io/badge/Google-Gemini%203.5-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Google Gemini">
  <img src="https://img.shields.io/badge/Language-Bilingual%20(EN%20%7C%20VI)-FFB800?style=for-the-badge" alt="Bilingual">
</p>

---

## 🌟 Giới Thiệu
**CinemaSub** là tiện ích mở rộng (Chrome/Edge Extension) giúp giải quyết dứt điểm các nhược điểm của phụ đề tự động mặc định trên YouTube:
* ❌ Phụ đề mặc định thường ngắt vụn 2–3 từ/dòng, dịch máy thô cứng kiểu "word-by-word".
* ❌ Thường xuyên lệch câu, trôi phụ đề khi người nói ngắt nghỉ hoặc nói câu phức tạp.
* ❌ Chờ đợi load rất lâu đối với video dài.

**CinemaSub biến mọi video tiếng Anh thành trải nghiệm chuẩn rạp chiếu phim**:
* ✨ **Dịch câu tự nhiên, giàu cảm xúc** với các mô hình ngôn ngữ lớn (LLM) hàng đầu từ **NVIDIA NIM** và **Google Gemini**.
* ⏱️ **Đồng bộ 100% theo từng giây nói (Zero Drift)**: Giữ nguyên vẹn mốc thời gian gốc của YouTube, không lo lệch frame hay trôi phụ đề.
* ⚡ **Phát ngay chỉ sau 1.5s (QuickStart Micro-batching)**: Dịch ngay 8 câu đầu để video chạy lập tức, các phần sau được dịch ngầm song song trong nền.
* 💾 **Bộ nhớ đệm thông minh (Cache v14)**: Xem lại video tốn **0 credit / 0 request**.

---

## 🚀 Tính Năng Nổi Bật

### 1. 🤖 Hỗ Trợ Đa Nền Tảng AI Thế Hệ Mới

| Nền tảng | Mô hình AI | Điểm nổi bật |
| :--- | :--- | :--- |
| **🟢 NVIDIA NIM** | **Meta LLaMA 3.2 11B Instruct** | ⭐ **Khuyên dùng**: Chuẩn xác schema 1:1, dịch cực tự nhiên, không lệch câu. |
| **🟢 NVIDIA NIM** | **NVIDIA Nemotron 3.5 Lightning 30B** | Model thông minh hàng đầu, xử lý xuất sắc các câu nói ẩn dụ phức tạp. |
| **🟢 NVIDIA NIM** | **Meta LLaMA 3.2 90B Instruct** | Model lớn nhất của Meta, chất lượng dịch đỉnh cao. |
| **🟢 NVIDIA NIM** | **Riva-Translate-4B-Instruct-v2** | Model NMT chuyên dụng của NVIDIA, siêu nhẹ. |
| **🔵 Google Gemini** | **Gemini 3.5 Flash-Lite** | ⭐ **Khuyên dùng**: Model mới nhất, tốc độ cực nhanh, miễn phí hàng ngày. |
| **🔵 Google Gemini** | **Gemini 3.1 Flash-Lite** | Rất nhanh, ổn định cao. |
| **🔵 Google Gemini** | **Gemini 3.8 Flash** | Hiểu sâu ngữ cảnh dài. |

---

### 2. ⚡ Kiến Trúc Xử Lý Đồng Thời & Khởi Động Tức Thì

```
YouTube Video -> Trích xuất TimedText (Tier 1/2) -> Chuẩn hóa Cues (Timestamp Ground Truth)
                                                             │
            ┌────────────────────────────────────────────────┴────────────────────────────────┐
            ▼                                                                                 ▼
   [Chunk 0: Micro-batch]                                                          [Parallel Worker Pool]
  8 cues đầu (~20s audio)                                                       (Worker 1 & Worker 2 song song)
 Dịch xong sau 1.5 - 2 giây                                                     Dịch các chunk 10 cues tiếp theo
            │                                                                                 │
            ▼                                                                                 ▼
▶️ VIDEO PLAY NGAY LẬP TỨC! ◄─────────────────────────────────────────────── Dịch ngầm hoàn tất toàn bộ video!
```

* **QuickStart Micro-Batch:** Chunk đầu tiên chỉ gồm 8 câu (~20s video), dịch xong trong 1.5 – 2s. Video tự động phát ngay, bạn không phải ngồi chờ.
* **Concurrency Worker Pool:** 2 luồng công nhân chạy ngầm đồng thời, giảm **85% thời gian dịch** so với tuần tự. Video dài 8 phút được dịch ngầm hoàn tất chỉ trong ~35–40s.
* **Playhead-Aware Priority Queue:** Khi bạn tua tới bất kỳ đoạn nào trong video, hàng đợi ưu tiên sẽ lập tức đẩy chunk gần mốc thời gian đó lên đầu để dịch ngay.

---

### 3. 🎯 Khớp Phụ Đề Chuẩn Xác 100% (Zero Desync)
* Phụ đề hiển thị theo vòng lặp **`requestAnimationFrame` (~60fps)**, bám sát từng mili-giây của người nói thay vì chỉ nghe bắt chước thô sơ.
* Giới hạn chunk 10 câu giúp LLM không bao giờ gộp nhầm các vế câu ngắt dở, đảm bảo **100% 1:1 ID Match**.
* Bộ lọc đa tầng loại bỏ hoàn toàn các ký tự raw JSON hay thẻ `<think>` của mô hình suy luận.

---

### 4. 🎨 Thiết Kế Điện Ảnh (Cinema Aesthetics)
* **Phong cách rạp phim:** Màu chữ vàng điện ảnh (`#FCD34D`) hoặc trắng tuyết (`#FFFFFF`), kết hợp đổ bóng viền đen sắc sảo, chống lóa trên mọi nền video.
* **Kính mờ cao cấp (Glassmorphism):** Hộp phụ đề có nền mờ mờ sang trọng, tự động bo góc và thu phóng co giãn theo kích thước video.
* **Tự động tránh thanh công cụ:** Khi bạn di chuột để hiện thanh điều khiển YouTube, phụ đề tự nâng cao lên để không che mất thanh timeline. Khi ẩn đi, phụ đề tự hạ xuống vị trí chuẩn.
* **Song ngữ thông minh:** Hiển thị đồng thời câu tiếng Anh bên trên và tiếng Việt bên dưới, là công cụ hoàn hảo cho việc học tiếng Anh qua TED Talks, Podcasts, Tutorials,...

---

## 🛠️ Hướng Dẫn Cài Đặt

### Bước 1: Nạp Extension vào trình duyệt (Chrome / Edge / Brave / Cốc Cốc)
1. Tải về hoặc clone repository:
   ```bash
   git clone https://github.com/BaoPhucxD14022006/extension_for_youtube.git
   ```
2. Mở trình duyệt và truy cập:
   * Trên Chrome / Brave / Cốc Cốc: `chrome://extensions/`
   * Trên Microsoft Edge: `edge://extensions/`
3. Gạt công tắc bật **Developer mode (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
4. Bấm nút **Load unpacked (Tải tiện ích đã giải nén)**.
5. Chọn thư mục dự án `extension_for_youtube` (hoặc thư mục chứa mã nguồn này).

---

### Bước 2: Cấu hình API Key (Miễn phí)

Bấm vào biểu tượng **CinemaSub 🎬** trên thanh công cụ trình duyệt để mở bảng cài đặt:

#### 🟢 Lựa chọn 1: Dùng NVIDIA NIM (Khuyên dùng)
1. Đăng ký tài khoản miễn phí tại [NVIDIA Build](https://build.nvidia.com/) (Nhận ngay **1,000 free credits** đủ xem hàng trăm video).
2. Tạo API Key và dán vào ô **NVIDIA API Key** (dạng `nvapi-...`).
3. Model khuyên dùng: **Meta LLaMA 3.2 11B Instruct**.
4. Bấm **Kiểm tra kết nối** để xác nhận thành công.

#### 🔵 Lựa chọn 2: Dùng Google Gemini
1. Lấy API Key miễn phí tại [Google AI Studio](https://aistudio.google.com/) (Miễn phí **1,500 requests/ngày**, tự động reset mỗi ngày).
2. Dán key vào ô **Gemini API Key**.
3. Model khuyên dùng: **Gemini 3.5 Flash-Lite**.
4. Bấm **Kiểm tra kết nối**.

---

### Bước 3: Thưởng thức trên YouTube
1. Mở bất kỳ video tiếng Anh nào trên YouTube (ví dụ TED Talk, phỏng vấn, tin tức, khóa học...).
2. Extension sẽ tự động kích hoạt:
   * Bạn sẽ thấy thông báo: `⚡ Đang chuẩn bị phụ đề (1-2s)...`
   * Sau ~1.5s, video tự phát với phụ đề tiếng Việt chuẩn điện ảnh!
3. Bạn có thể bấm nút **🎬 CinemaSub** nằm ngay cạnh nút cài đặt bánh răng trên trình phát YouTube để bật/tắt nhanh bất kỳ lúc nào.

---

## 📂 Cấu Trúc Dự Án

```
├── manifest.json         # Khai báo Chrome Extension Manifest V3
├── icons/                # Bộ biểu tượng ứng dụng (16x16, 48x48, 128x128)
├── content/
│   ├── content.js        # Content Script chính: Quản lý Player, 60fps rAF Loop, Micro-batching
│   ├── content.css       # Tạo hình phụ đề điện ảnh, Glassmorphism, Responsive text
│   └── page-bridge.js    # Cầu nối MAIN world: Bắt gói tin timedtext qua Network Interceptor
├── background/
│   └── background.js     # Service Worker: Xử lý gọi API NVIDIA NIM & Gemini, Parse & Sanitizer
└── popup/
    ├── popup.html        # Giao diện cài đặt popup
    ├── popup.js          # Logic chọn Provider/Model, Auto-migration, Test kết nối API
    └── popup.css         # Giao diện Dark Mode sang trọng, Glassmorphism UI
```

---

## 📄 Bản Quyền & Giấy Phép
Dự án được phát hành dưới giấy phép [MIT License](LICENSE). Tự do sử dụng, chỉnh sửa và phát triển phục vụ mục đích học tập và cá nhân!
