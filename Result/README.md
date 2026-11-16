# Firmware Khóa Cửa Thông Minh ESP32-CAM (`Result`)

Dự án tích hợp hoàn chỉnh **F2 (Nhận diện khuôn mặt - Edge Impulse)** + **F1 (Nhận diện lòng bàn tay - PalmAlgorithm)** + **Kết nối Backend/Web Control** để nạp trực tiếp vào **AI-Thinker ESP32-CAM** qua Arduino IDE.

---

## 1. Cấu trúc thư mục `Result/`

- `Result.ino`: Chương trình chính (tự động quét nhận diện, chạy song song `networkTask` trên Core 0 và AI trên Core 1 để lệnh Web không bị trễ khi đang quét lòng bàn tay).
- `config.h`: Toàn bộ cấu hình Wi-Fi, API Backend, `DEVICE_ID`, `DEVICE_CREDENTIAL`, `ROOT_CA_CERT`, ngưỡng nhận diện, chân GPIO và **placeholder UUID người dùng**.
- `app_types.h`: Định nghĩa kiểu dữ liệu dùng chung cho sketch Arduino.
- `PalmAlgorithm.h`, `model_spec.h`, `model_runtime.h`, `model_runtime.cpp`, `deflate_inflate.h`, `generated_model.h`: Thư viện nhận diện lòng bàn tay `F1` được đóng gói sẵn và nén trọng số (giải nén vào PSRAM khi suy luận) để vừa gọn trong phân vùng `Huge APP (3MB No OTA/1MB SPIFFS)`.

---

## 2. Sơ đồ nối dây (3 chân điều khiển)

| Chức năng | Chân ESP32-CAM | Mức logic |
|---|---|---|
| Điều khiển khóa (`PIN_KHOA`) | **GPIO 13** | `LOW` = Mở khóa, `HIGH` = Đóng khóa |
| Đèn LED xanh (`PIN_LED_XANH`) | **GPIO 14** | `HIGH` = Sáng |
| Đèn LED đỏ (`PIN_LED_DO`) | **GPIO 15** | `HIGH` = Sáng |

> **Lưu ý phần cứng:** GPIO 13, 14, 15 dùng chung chân khe thẻ nhớ microSD trên board AI-Thinker ESP32-CAM, vì vậy **không cắm thẻ nhớ microSD** khi sử dụng. GPIO 15 đồng thời là chân strapping (`MTDO`), cần đảm bảo mạch LED đỏ không kéo sai trạng thái bất thường lúc cấp nguồn.

### Ý nghĩa trạng thái LED

| Trạng thái | LED Xanh (GPIO 14) | LED Đỏ (GPIO 15) |
|---|---|---|
| Đang chờ quét tự động | Tắt | Tắt |
| Đang nhận diện (khuôn mặt / lòng bàn tay) | Nhấp nháy nhanh | Tắt |
| Đã mở khóa (5 giây sinh trắc / tối đa 30 giây từ Web) | Sáng liên tục | Tắt |
| Từ chối / Sai nhận diện (1.5 giây) | Tắt | Sáng liên tục |
| Tạm khóa 60 giây (sau 5 lần sai liên tiếp) | Tắt | Nhấp nháy (0.5s) |

---

## 3. Cấu hình trước khi nạp code (`config.h`)

Mở file `config.h` (tab thứ 2 trong Arduino IDE) và điền **UUID người dùng** từ trang Web quản trị (mục **Người dùng** -> chi tiết người dùng / bảng `access_users` trên Supabase):

```cpp
static const char FACE_OWNER_USER_ID[] = "PASTE_UUID_CHU_NHA_KHUON_MAT";

static const char *const PALM_USER_IDS[4] = {
  "PASTE_UUID_PERSON_01", // person_01
  "PASTE_UUID_PERSON_02", // person_02
  "PASTE_UUID_PERSON_03", // person_03
  "PASTE_UUID_PERSON_04"  // person_04
};
```

- Vị trí nào chưa dùng thì giữ nguyên `"PASTE_..."`.
- Trên Web quản trị, hãy tạo **Quyền truy cập** (`is_allowed = true`) và yêu cầu **Enrollment** (`pending`) cho các UUID tương ứng với thiết bị này. Khi ESP32-CAM kết nối và chạy `/device/sync` (hoặc bạn bấm **Đồng bộ quyền** trên Web), firmware sẽ tự xác nhận các enrollment khớp UUID sang trạng thái `completed`.
- Ngưỡng lòng bàn tay hiện đặt tại `NGUONG_BAN_TAY = 0.15f` trong `config.h`.
- Khi mất Wi-Fi / Backend không phản hồi, firmware cho phép mở cục bộ 5 giây (`ALLOW_OFFLINE_LOCAL_UNLOCK = true`).
- Các sự kiện bị từ chối (`nguoi_la` / `unknown_palm`) sẽ được gửi lên nhật ký Web (`REPORT_DENIED_EVENTS = true`).

---

## 4. Hướng dẫn nạp qua Arduino IDE

1. Mở trực tiếp file `Result/Result.ino` bằng Arduino IDE.
2. Đảm bảo đã cài thư viện:
   - **ArduinoJson** (6.x hoặc 7.x) qua Library Manager.
   - Thư viện Edge Impulse khuôn mặt của bạn (`KhoaCua_inferencing` — nếu tên khác, sửa dòng `#include <KhoaCua_inferencing.h>` ở đầu `Result.ino`).
3. Chọn cấu hình trong menu **Tools**:
   - **Board**: `AI Thinker ESP32-CAM`
   - **PSRAM**: `Enabled`
   - **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)`
   - **Upload Speed**: `115200` (hoặc `460800`)
4. **Lưu ý nếu gặp lỗi vượt dung lượng Flash (`Sketch too big`):**
   - Do mô hình lòng bàn tay (`generated_model.h`) chiếm ~2.0 MB Flash, khi ghép chung với Edge Impulse + Wi-Fi/TLS có thể vượt mốc 3.0 MB của `Huge APP`.
   - Nếu gặp lỗi này, có thể chuyển Board sang `ESP32 Dev Module` (hoặc `ESP32 Wrover Module` có **PSRAM Enabled**, **Flash Size: 4MB**, **Partition Scheme: Custom**) và tạo file `partitions.csv` trong thư mục `Result/` để tăng `app0` lên ~3.87 MB (`0x3E0000`), hoặc giảm kích thước ảnh/mô hình Edge Impulse khi export.

---

## 5. Điều khiển & Kiểm tra qua Serial Monitor (`115200` baud)

Gửi 1 ký tự qua Serial Monitor để kiểm tra nhanh:
- `i` : Xem trạng thái Wi-Fi, NTP, Token, GPIO 13 (`locked`/`unlocked`), bộ nhớ Heap/PSRAM và trạng thái UUID.
- `t` : Bật/tắt chế độ **THỬ** (in điểm khuôn mặt F2 + lòng bàn tay F1 liên tục, không mở khóa và không gửi log lên Web — dùng để chỉnh ngưỡng `0.15`).
- `s` : Chụp 1 khung và test riêng nhận diện lòng bàn tay `F1`.
- `f` : Chụp 1 khung và test riêng nhận diện khuôn mặt `F2`.
- `l` : In 50 dòng nhật ký gần nhất lưu trong NVS.
- `x` : Xóa nhật ký NVS.
