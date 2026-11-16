# Face Access Control System

Hệ thống quản trị kiểm soát ra vào bằng Vue 3, Express và Supabase. ESP32-CAM nhận diện tại thiết bị; backend kiểm tra lại quyền hiện hành trước khi ghi sự kiện `allowed`.

## Báo cáo hiện trạng

### Schema Supabase đã kiểm tra

OpenAPI của dự án Supabase đang cấu hình được truy vấn ở chế độ chỉ đọc. Schema thật có chín bảng dưới đây; các tên bảng/cột, khóa và kiểu enum được đối chiếu với phần code đang dùng. `users` trong giao diện là danh tính ra vào lưu ở `access_users`; đây không phải bảng đăng nhập. Tài khoản web nằm trong Supabase Auth và bảng `profiles`.

| Bảng | Khóa chính | Khóa ngoại | Trường và kiểu quan trọng |
|---|---|---|---|
| `profiles` | `id` | — | `full_name`, `role` (`admin/operator/viewer`), `is_active`, thời gian |
| `access_users` | `id` | `created_by → profiles.id` | mã nhân viên, họ tên, email, điện thoại, phòng ban, avatar, hoạt động, ghi chú, thời gian |
| `devices` | `id` | — | mã/tên/vị trí, `status` (`online/offline/maintenance`), firmware, `last_seen_at`, `device_token_hash`, hoạt động, thời gian |
| `face_enrollments` | `id` | `user_id → access_users.id`, `device_id → devices.id` | `status` (`pending/completed/failed/revoked`), template reference, các thời điểm enrollment |
| `access_permissions` | `id` | user, device, `created_by → profiles.id` | thời hạn, `is_allowed`, lý do, thời gian |
| `access_events` | `id` | user, device | quyết định (`allowed/denied`), confidence, nguồn, lý do, snapshot path, idempotency key, thời gian |
| `device_commands` | `id` | device, `requested_by → profiles.id` | `command` (`unlock/sync_permissions/restart` hiện tại), `status` (`pending/sent/acknowledged/failed/expired`), payload, hết hạn, kết quả |
| `device_sync_state` | `device_id` | `device_id → devices.id` | phiên bản quyền, thời gian đồng bộ |
| `audit_logs` | `id` | `actor_id → profiles.id` | hành động, loại/resource ID, metadata JSON, thời gian |

OpenAPI xác nhận `audit_logs` và các RPC từ migration audit/safety đang được cung cấp bởi Data API. OpenAPI không công bố RLS policies; trạng thái các policy cũ vì vậy chưa được xác minh. Backend dùng server-only key, còn browser chỉ gọi Express.

## Thành phần

- `front-end/`: Vue 3 Composition API, Vue Router, Pinia, Axios, PrimeVue và giao diện tiếng Việt responsive.
- `back-end/`: Express REST API, Supabase JS, xác thực Supabase Auth, phân quyền `admin`/`operator`/`viewer`, rate limit, validation và xử lý lỗi tập trung.
- `back-end/supabase/migrations/`: migration audit/RPC hiện có và migration cộng thêm trạng thái cửa cùng lệnh khóa từ xa.
- `back-end/docs/API.md`: endpoint và giao thức tích hợp ESP32-CAM.
- `back-end/docs/DATABASE.md`: schema, khóa và enum thực tế đã kiểm tra từ OpenAPI Supabase.

## Cài đặt và chạy

Yêu cầu Node.js 20.19+ (khuyến nghị bản LTS hiện hành).

1. Cấu hình `back-end/.env` theo `back-end/.env.example`. Dùng `SUPABASE_SERVICE_ROLE_KEY` chỉ ở backend (tên cũ `SUPABASE_SECRET_KEY` vẫn được nhận để tương thích), cùng `SUPABASE_PUBLISHABLE_KEY` cho Supabase Auth. Không đưa service role key vào frontend hoặc firmware.
2. Đặt `DEVICE_TOKEN_SECRET` thành chuỗi ngẫu nhiên dài tối thiểu 32 ký tự. Tên cũ `DEVICE_JWT_SECRET` vẫn được hỗ trợ.
3. Database đang cấu hình đã cung cấp `audit_logs` và các RPC trong hai migration cũ. Review và chỉ áp dụng migration còn thiếu `202611160001_door_state_and_lock_command.sql` trước khi dùng trạng thái cửa/lệnh `lock`. Migration này không xóa dữ liệu hay đổi tên bảng/cột.
4. Tạo tài khoản admin đầu tiên trong Supabase Auth và đặt profile tương ứng thành `role = 'admin'`, `is_active = true` qua quy trình quản trị tin cậy. Không có endpoint bootstrap admin công khai.
5. Trong Supabase Auth, bật đăng ký email cho người dùng mới và cấu hình xác nhận email. Thêm URL `AUTH_SIGNUP_REDIRECT_URL` vào redirect allowlist; URL mẫu chuyển về `/login?confirmed=1`. Cấu hình `AUTH_INVITE_REDIRECT_URL` để lời mời quản trị chuyển về trang `/invite`.

Chạy backend:

```powershell
cd back-end
npm install
npm run dev
```

Chạy frontend trong terminal khác:

```powershell
cd front-end
npm install
npm run dev
```

Vite chạy ở `http://localhost:5173` và proxy `/api` về `http://localhost:5000`. Có thể đổi URL bằng `VITE_API_BASE_URL` và `VITE_DEV_API_TARGET`. Backend chỉ cho phép origin trong `CORS_ORIGINS`.

## Chức năng đã triển khai

- Đăng ký công khai bằng email, xác minh email qua Supabase Auth, role mặc định `viewer`; đăng nhập, refresh, đăng xuất, hồ sơ cá nhân, đổi mật khẩu và nhận lời mời tài khoản.
- Quản lý người dùng ra vào; xóa là vô hiệu hóa mềm để giữ lịch sử.
- Tạo/theo dõi/thu hồi enrollment tại thiết bị; không upload ảnh hoặc mẫu sinh trắc học lên Supabase.
- Quản lý thiết bị, heartbeat, credential hash, xoay credential và lệnh khóa/mở có thời hạn ngắn. Web đợi ACK thật; lệnh đang chờ hoặc chưa rõ kết quả không được tự gửi lại.
- Dashboard và chi tiết thiết bị tự cập nhật qua API polling; trạng thái cửa lấy từ báo cáo gần nhất của firmware.
- Nhật ký hợp nhất sự kiện ra vào với từng lệnh cửa và trạng thái cuối trong cùng một dòng, có bộ lọc và CSV.
- Trang cài đặt hiển thị kết nối backend/Supabase và các timeout hiện hành, không hiển thị secret.
- Cấp/sửa/thu hồi quyền; backend yêu cầu người dùng/thiết bị đang hoạt động và đẩy phiên bản đồng bộ.
- Ghi sự kiện bất biến theo idempotency key. Backend từ chối quyết định `allowed` nếu người dùng không hoạt động, thiết bị bảo trì, có quyền từ chối còn hiệu lực, không có quyền cho phép hoặc enrollment chưa hoàn tất.
- Dashboard lấy số liệu thật từ API; không có dữ liệu demo.
- Bộ lọc, phân trang, chi tiết và xuất CSV; CSV chống spreadsheet formula injection.

## Giới hạn tích hợp

- Chưa có source firmware ESP32-CAM trong workspace. Firmware cần hỗ trợ command `lock`, gửi heartbeat `door_state: locked|unlocked|unknown`, lưu ID đã xử lý để tránh chạy trùng và chỉ ACK sau khi hoàn tất thao tác phần cứng. Chi tiết giao thức nằm trong `back-end/docs/API.md`; chưa thể kiểm chứng trên phần cứng.
- API không nhận ảnh snapshot; `snapshot_path` và `template_reference` không được trả ra giao diện. Cần thiết kế storage và quyền truy cập riêng nếu muốn bật ảnh.
- Cơ chế chống replay hiện giữ nonce trong bộ nhớ tiến trình. Khi triển khai nhiều instance backend, cần chuyển nonce store sang Redis hoặc storage dùng chung trước khi scale.
- Cần review RLS policies hiện hữu trong Supabase Dashboard/SQL export đầy đủ. Không nên cấp truy cập database trực tiếp cho browser.
- Không có thông tin tài khoản admin hoặc firmware để chạy kiểm thử end-to-end thật.

## Kiểm tra

```powershell
cd back-end; npm test; npm run lint
cd ..\front-end; npm test; npm run lint; npm run build
```

Các bài test kiểm tra UUID, phân trang, escaping truy vấn, đăng ký, formatter giao diện và theo dõi ACK/timeout mà không gửi lại lệnh. Tích hợp Supabase/firmware cần xác minh riêng sau khi áp dụng migration và cấu hình thiết bị.

## Mẫu kết nối firmware ESP32-CAM (Arduino)

Firmware kết nối bằng HTTPS tới Express, không kết nối trực tiếp Supabase. Trong trang **Thiết bị**, tạo thiết bị rồi chép `device_credential` hiển thị một lần. Firmware chỉ lưu credential này; không nhúng `SUPABASE_SERVICE_ROLE_KEY`, `DEVICE_TOKEN_SECRET` hay token web vào sketch.

Trước khi chạy, thay các giá trị mẫu, cài ArduinoJson và thêm CA certificate của máy chủ vào `WiFiClientSecure`. Không dùng `setInsecure()` trên mạng thật. Đồng bộ giờ NTP trước request đầu tiên vì timestamp phải lệch máy chủ không quá 90 giây.

```cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

const char* API_BASE = "https://your-domain.example.com/api";
const char* WIFI_SSID = "<wifi-ssid>";
const char* WIFI_PASSWORD = "<wifi-password>";
const char* DEVICE_ID = "<uuid-thiet-bi>";
const char* DEVICE_CREDENTIAL = "<credential-cap-mot-lan>";
const char* ROOT_CA = R"CERT(
-----BEGIN CERTIFICATE-----
<CA-certificate-cua-may-chu>
-----END CERTIFICATE-----
)CERT";

WiFiClientSecure tls;
String deviceToken;
uint32_t tokenExpiresAt = 0;

String newNonce() {
  char value[17];
  snprintf(value, sizeof(value), "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
  return String(value); // 16 ký tự hex, phải tạo nonce mới cho mỗi POST
}

void addFreshHeaders(HTTPClient& http) {
  http.addHeader("X-Device-Timestamp", String((unsigned long)time(nullptr)));
  http.addHeader("X-Device-Nonce", newNonce());
}

bool authenticateDevice() {
  HTTPClient http;
  if (!http.begin(tls, String(API_BASE) + "/device/auth")) return false;
  http.addHeader("Content-Type", "application/json");
  addFreshHeaders(http);

  StaticJsonDocument<256> request;
  request["device_id"] = DEVICE_ID;
  request["credential"] = DEVICE_CREDENTIAL;
  String body;
  serializeJson(request, body);

  int code = http.POST(body);
  String response = http.getString();
  http.end();
  if (code != 200) return false;

  StaticJsonDocument<512> result;
  if (deserializeJson(result, response)) return false;
  deviceToken = result["data"]["access_token"].as<String>();
  tokenExpiresAt = millis() + 240000; // làm mới trước khi JWT 5 phút hết hạn
  return deviceToken.length() > 0;
}

bool ensureDeviceToken() {
  return deviceToken.length() > 0 && (int32_t)(tokenExpiresAt - millis()) > 0
      ? true : authenticateDevice();
}

void addDeviceHeaders(HTTPClient& http) {
  http.addHeader("Authorization", "Bearer " + deviceToken);
  http.addHeader("X-Device-Id", DEVICE_ID);
}

bool sendHeartbeat(const char* doorState) {
  if (!ensureDeviceToken()) return false;
  HTTPClient http;
  if (!http.begin(tls, String(API_BASE) + "/device/heartbeat")) return false;
  http.addHeader("Content-Type", "application/json");
  addDeviceHeaders(http);
  addFreshHeaders(http);

  StaticJsonDocument<192> body;
  body["firmware_version"] = "1.0.0";
  body["door_state"] = doorState; // locked, unlocked, hoặc unknown
  String json;
  serializeJson(body, json);
  int code = http.POST(json);
  http.end();
  return code == 200;
}

// Gọi GET /device/commands/pending mỗi ~2 giây, không cần timestamp/nonce.
// Với mỗi lệnh, thực thi đúng một lần theo command.id rồi gọi hàm ACK bên dưới.
// Lưu command.id và kết quả ACK vào Preferences/NVS để xử lý an toàn khi mất điện
// hoặc mất response; nếu ID đã lưu, gửi lại ACK đã lưu, tuyệt đối không kích relay lại.

bool sendCommandAck(const String& commandId, const char* status, const char* doorState) {
  if (!ensureDeviceToken()) return false;
  HTTPClient http;
  if (!http.begin(tls, String(API_BASE) + "/device/commands/" + commandId + "/ack")) return false;
  http.addHeader("Content-Type", "application/json");
  addDeviceHeaders(http);
  addFreshHeaders(http);

  StaticJsonDocument<192> body;
  body["status"] = status; // acknowledged hoặc failed
  body["response"]["door_state"] = doorState;
  if (String(status) == "failed") body["error_message"] = "Thao tác phần cứng thất bại";
  String json;
  serializeJson(body, json);
  int code = http.POST(json);
  http.end();
  return code == 200;
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  tls.setCACert(ROOT_CA);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  while (time(nullptr) < 1700000000) delay(250); // chờ NTP để timestamp hợp lệ
  if (!authenticateDevice()) Serial.println("Device authentication failed");
}
```

Thứ tự request và JSON firmware cần gửi:

1. **Lấy JWT thiết bị:** `POST /api/device/auth` với `device_id` và `credential`; kèm `X-Device-Timestamp` (Unix giây) và `X-Device-Nonce` (nonce mới, tối thiểu 16 ký tự). JWT hết hạn sau 5 phút.
2. **Heartbeat:** `POST /api/device/heartbeat` với `Authorization: Bearer <jwt>`, `X-Device-Id`, timestamp/nonce mới và body như `{"firmware_version":"1.0.0","door_state":"unknown"}`. Gửi heartbeat khoảng 30 giây/lần.
3. **Nhận lệnh:** `GET /api/device/commands/pending` với `Authorization` và `X-Device-Id`. Lệnh có thể được giao lại; kiểm tra ID đã xử lý trước khi điều khiển relay. Hỗ trợ `unlock`, `lock`, `sync_permissions`, `restart`.
4. **ACK:** sau khi xử lý lệnh, `POST /api/device/commands/<command-id>/ack` với timestamp/nonce mới và body `{"status":"acknowledged","response":{"door_state":"locked"}}`; nếu thao tác lỗi, gửi `status: "failed"` cùng `error_message`.
5. **Gửi sự kiện nhận diện:** `POST /api/device/events` với timestamp/nonce mới, `Idempotency-Key` mới và body gồm `user_id`, `decision`, `confidence`, `occurred_at` (xem ví dụ ở [API.md](</D:/Code/Iot/Code Web Control/back-end/docs/API.md>)).

Trạng thái `door_state` chỉ phản ánh giá trị phần cứng firmware đo được. Nếu ESP32-CAM chưa có công tắc/cảm biến cửa, gửi `unknown`; không báo `locked` chỉ dựa trên việc đã bật relay. Cần áp dụng migration `202611160001_door_state_and_lock_command.sql` trước khi backend nhận `door_state` và lệnh `lock`.
