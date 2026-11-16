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

## Firmware kết nối ESP32-CAM (Arduino)

Ví dụ tối giản gồm ba hàm: giữ kết nối và xác thực thiết bị, nhận lệnh đang chờ, gửi heartbeat/trạng thái cửa. ESP32-CAM gọi API backend qua HTTPS, không kết nối trực tiếp Supabase.

Thay các giá trị mẫu trước khi nạp firmware:

- API_BASE: URL backend kèm /api, ví dụ https://api.example.com/api.
- DEVICE_ID: UUID của thiết bị trong hệ thống, không phải device_code.
- DEVICE_CREDENTIAL: credential thiết bị được cấp khi tạo thiết bị; chỉ hiển thị một lần.
- ROOT_CA: CA certificate hợp lệ của máy chủ HTTPS. Không dùng setInsecure() trên mạng thật.
- Cài thư viện ArduinoJson. Backend yêu cầu giờ NTP chính xác (sai lệch tối đa 90 giây) cho request xác thực và heartbeat.

~~~cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <time.h>

const char* WIFI_SSID = "Top1tg";
const char* WIFI_PASSWORD = "87654321";
const char* API_BASE = "https://web-control-esp32-cam.onrender.com/api";
const char* DEVICE_ID = "9cb7ac34-adfd-4785-ae43-023e321d2dcb";
const char* DEVICE_CREDENTIAL = "D-GRKc46apMmclTo-_1UctNT6DSY9W66w8PnPvuzD10";
const char* ROOT_CA = R"CERT(
-----BEGIN CERTIFICATE-----
<CA-certificate-cua-may-chu>
-----END CERTIFICATE-----
)CERT";

WiFiClientSecure tls;
String deviceToken;
uint32_t tokenExpiresAt = 0;
uint32_t nextConnectionAttemptAt = 0;
bool connectionRetryPending = false;

// 1. Kết nối Wi-Fi, lấy JWT và tự xác thực lại trước khi JWT hết hạn.
bool maintainConnection() {
  const bool tokenIsValid = deviceToken.length() > 0 &&
      (int32_t)(tokenExpiresAt - millis()) > 30000;
  if (WiFi.status() == WL_CONNECTED && tokenIsValid) return true;
  if (connectionRetryPending &&
      (int32_t)(millis() - nextConnectionAttemptAt) < 0) return false;

  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    const uint32_t startedAt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 10000) {
      delay(250);
    }
    if (WiFi.status() != WL_CONNECTED) {
      connectionRetryPending = true;
      nextConnectionAttemptAt = millis() + 10000;
      Serial.println("[WIFI] reconnect failed; retry in 10s");
      return false;
    }
  }

  if (deviceToken.length() > 0 &&
      (int32_t)(tokenExpiresAt - millis()) > 30000) {
    connectionRetryPending = false;
    return true;
  }

  if (time(nullptr) < 1700000000) {
    connectionRetryPending = true;
    nextConnectionAttemptAt = millis() + 10000;
    Serial.println("[NTP] clock not ready; retry in 10s");
    return false;
  }

  connectionRetryPending = true;
  nextConnectionAttemptAt = millis() + 10000;
  HTTPClient http;
  if (!http.begin(tls, String(API_BASE) + "/device/auth")) {
    Serial.println("[AUTH] could not start HTTPS request");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Timestamp", String((unsigned long)time(nullptr)));

  char nonce[17];
  snprintf(nonce, sizeof(nonce), "%08lx%08lx",
           (unsigned long)esp_random(), (unsigned long)esp_random());
  http.addHeader("X-Device-Nonce", nonce);

  StaticJsonDocument<256> request;
  request["device_id"] = DEVICE_ID;
  request["credential"] = DEVICE_CREDENTIAL;
  String body;
  serializeJson(request, body);

  const int code = http.POST(body);
  const String response = http.getString();
  Serial.printf("[AUTH] HTTP=%d, free heap=%u\n", code, ESP.getFreeHeap());
  http.end();
  if (code != 200) {
    deviceToken = "";
    tokenExpiresAt = 0;
    return false;
  }

  StaticJsonDocument<512> result;
  if (deserializeJson(result, response)) return false;
  deviceToken = result["data"]["access_token"].as<String>();
  const uint32_t expiresIn = result["data"]["expires_in"] | 300;
  tokenExpiresAt = millis() + expiresIn * 1000UL;
  connectionRetryPending = false;
  return deviceToken.length() > 0;
}

// 2. Lấy lệnh đang chờ; trả về chuỗi "command-id|command", hoặc chuỗi rỗng.
String receiveRequest() {
  if (!maintainConnection()) return "";

  HTTPClient http;
  if (!http.begin(tls, String(API_BASE) + "/device/commands/pending")) return "";
  http.addHeader("Authorization", "Bearer " + deviceToken);
  http.addHeader("X-Device-Id", DEVICE_ID);

  const int code = http.GET();
  const String response = http.getString();
  Serial.printf("[POLL] HTTP=%d, bytes=%u, free heap=%u\n",
                code, response.length(), ESP.getFreeHeap());
  http.end();
  if (code != 200) {
    if (code == 401) {
      deviceToken = "";
      tokenExpiresAt = 0;
    }
    return "";
  }

  DynamicJsonDocument result(8192);
  if (deserializeJson(result, response)) return "";
  JsonArray commands = result["data"].as<JsonArray>();
  if (commands.isNull() || commands.size() == 0) return "";

  JsonObject command = commands[0];
  const String id = command["id"] | "";
  const String name = command["command"] | "";
  if (id.length() == 0 || name.length() == 0) return "";
  return id + "|" + name;
}

// 3. Báo phiên bản firmware và trạng thái cửa thực tế lên backend.
bool sendStatus(const char* doorState) {
  if (!maintainConnection()) return false;

  HTTPClient http;
  if (!http.begin(tls, String(API_BASE) + "/device/heartbeat")) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + deviceToken);
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Timestamp", String((unsigned long)time(nullptr)));

  char nonce[17];
  snprintf(nonce, sizeof(nonce), "%08lx%08lx",
           (unsigned long)esp_random(), (unsigned long)esp_random());
  http.addHeader("X-Device-Nonce", nonce);

  StaticJsonDocument<192> body;
  body["firmware_version"] = "1.0.0";
  body["door_state"] = doorState; // locked, unlocked hoặc unknown
  String json;
  serializeJson(body, json);

  const int code = http.POST(json);
  Serial.printf("[HEARTBEAT] HTTP=%d, free heap=%u\n", code, ESP.getFreeHeap());
  http.end();
  if (code == 401) {
    deviceToken = "";
    tokenExpiresAt = 0;
  }
  return code == 200;
}

void setup() {
  Serial.begin(115200);
  Serial.println("[BOOT] setup started");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  tls.setCACert(ROOT_CA);
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  Serial.println("[BOOT] Wi-Fi and NTP started");
  maintainConnection();
}

void loop() {
  static uint32_t lastPollAt = 0;
  static uint32_t lastHeartbeatAt = 0;

  if (millis() - lastPollAt >= 10000) {
    lastPollAt = millis();
    const String request = receiveRequest();
    if (request.length() > 0) {
      Serial.println("Lenh nhan duoc: " + request);
      // Gọi phần xử lý relay/cảm biến của bạn tại đây.
    }
  }

  if (millis() - lastHeartbeatAt >= 30000) {
    lastHeartbeatAt = millis();
    // Chỉ gửi locked/unlocked nếu có cảm biến xác nhận; nếu không gửi unknown.
    sendStatus("unknown");
  }

  delay(20);
}
~~~

receiveRequest() chỉ đọc lệnh, chưa điều khiển relay và chưa gửi ACK. Backend có thể giao lại lệnh ở lần poll sau cho tới khi thiết bị gọi POST /api/device/commands/<command-id>/ack; vì vậy cần thêm xử lý chống chạy lặp và ACK sau khi thao tác phần cứng thành công trước khi dùng lệnh khóa/mở cửa thực tế. sendStatus() chỉ gửi heartbeat; trạng thái phải phản ánh cảm biến cửa, không suy ra từ việc bật relay.
