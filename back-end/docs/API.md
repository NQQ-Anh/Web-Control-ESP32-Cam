# REST API và giao thức ESP32-CAM

Base URL backend mặc định: `http://localhost:5000/api`. Response JSON thông thường có `{ success, data, message? }`; danh sách có thêm `pagination: { page, limit, total }`. Lỗi tập trung có `{ success: false, message, request_id }`, không chứa stack trace.

## Vai trò

| Vai trò | Đọc | Thay đổi |
|---|---|---|
| `admin` | Toàn bộ module | Tất cả; quản lý tài khoản admin và vai trò |
| `operator` | Toàn bộ module | Người dùng, thiết bị, quyền, enrollment và lệnh thiết bị |
| `viewer` | Dashboard, danh sách và chi tiết | Không được thay đổi dữ liệu |

Role luôn được đọc từ `profiles` sau khi xác minh access token bằng Supabase Auth. Không sử dụng role gửi từ browser.

## Endpoint quản trị

Các endpoint sau yêu cầu `Authorization: Bearer <Supabase access token>`, trừ login, refresh, health và `device/auth`.

| Method | Endpoint | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/health` | Công khai | Kiểm tra backend và truy vấn DB nhẹ |
| POST | `/auth/register` | Công khai, giới hạn 5 lần/15 phút/IP | `{ full_name, email, password }`; tài khoản tự đăng ký nhận role `viewer`, xác minh email theo cấu hình Supabase |
| POST | `/auth/login` | Công khai | `{ email, password }` |
| POST | `/auth/refresh` | Công khai | `{ refresh_token }`; kiểm tra lại profile/role |
| POST | `/auth/logout` | Đã đăng nhập | Thu hồi phiên Supabase hiện tại |
| GET/PATCH | `/auth/me` | Đã đăng nhập | PATCH chỉ nhận `{ full_name }` |
| PUT | `/auth/password` | Đã đăng nhập | `{ password }`, tối thiểu 12 ký tự |
| POST | `/auth/accept-invite` | Công khai, rate limited | `{ token_hash, password }` từ email mời |
| GET/POST/PUT/PATCH status/DELETE | `/users` và `/users/:id` | Đọc: mọi role; ghi: admin/operator | DELETE vô hiệu hóa mềm |
| GET | `/devices/:id/status` | Đã đăng nhập | Trạng thái kết nối, cửa được báo gần nhất và heartbeat |
| GET/POST/PUT/PATCH status/active/DELETE | `/devices` và `/devices/:id` | Đọc: mọi role; ghi: admin/operator | DELETE vô hiệu hóa; `/active` cho kích hoạt lại |
| POST | `/devices/:id/credentials/rotate` | Admin | Credential cũ bị thu hồi ngay; raw token chỉ trả một lần |
| GET/POST | `/devices/:id/commands` | Đọc: mọi role; tạo: admin/operator | `command`: `unlock`, `lock`, `sync_permissions`, `restart`; `lock` cần migration mới |
| GET | `/devices/:id/events` | Đã đăng nhập | Lịch sử thiết bị, chỉ đọc |
| GET/POST/PUT/PATCH status/DELETE | `/permissions` và `/permissions/:id` | Đọc: mọi role; ghi: admin/operator | DELETE/PATCH thu hồi bằng `is_allowed=false` |
| GET/POST/PATCH status/DELETE | `/enrollments` và `/enrollments/:id` | Đọc: mọi role; ghi: admin/operator | POST tạo `pending`; chỉ thiết bị mới báo `completed` |
| GET | `/events`, `/events/:id`, `/events/export` | Đã đăng nhập | Nhật ký chỉ đọc; export CSV tối đa 10.000 hàng |
| GET | `/history`, `/history/export` | Đã đăng nhập | Dòng thời gian hợp nhất sự kiện ra vào và lệnh cửa cùng trạng thái cuối; phân trang/bộ lọc và CSV |
| GET | `/dashboard/summary`, `/access-statistics`, `/recent-events`, `/device-statistics` | Đã đăng nhập | Tất cả thống kê lấy từ Supabase |
| GET | `/commands/:id` | Đã đăng nhập | Trạng thái ACK của một lệnh |
| GET | `/system/status` | Đã đăng nhập | Trạng thái backend/Supabase và timeout; không trả secret |
| GET/POST/PUT/PATCH status | `/admins` và `/admins/:id` | Admin | POST gửi lời mời email; role/status chỉ admin được đổi |

Tự đăng ký dùng Supabase Auth `signUp`; backend tạo profile và gán `viewer`, không nhận role do client gửi lên. Nếu bật xác nhận email, người dùng cần xác minh trước khi đăng nhập. Cấu hình `AUTH_SIGNUP_REDIRECT_URL` trong Supabase Auth redirect allowlist để email xác nhận quay về `/login?confirmed=1`.

Danh sách hỗ trợ `page`, `limit` (1–100), `q` và filter theo module. `/events` hỗ trợ lọc event theo `user_id`, `device_id`, `decision`, `from`, `to`, `q`. `/history` hợp nhất `access_events` với mỗi bản ghi `device_commands` (request và kết quả ACK nằm cùng một dòng), lọc `user_id`, `device_id`, `event_type=face|door_command`, `result`, `from`, `to`, `q`; trang tối đa 10.000 dòng.

## ESP32-CAM: credential và timestamp

### 1. Cấp credential

Admin/operator tạo thiết bị bằng `POST /devices`:

```json
{
  "device_code": "GATE-01",
  "device_name": "Cổng chính",
  "location": "Tầng trệt",
  "firmware_version": "1.0.0"
}
```

Response trả `data.device` và `data.device_credential`. Credential ngẫu nhiên chỉ xuất hiện một lần; DB chỉ lưu bcrypt hash. Không ghi credential vào log/firmware repository. Xoay vòng bằng `POST /devices/:id/credentials/rotate`.

### 2. Đổi credential lấy JWT thiết bị

Gửi `POST /device/auth` qua HTTPS với nonce duy nhất và timestamp Unix giây:

```http
X-Device-Timestamp: 1793790000
X-Device-Nonce: 48a4c8f5a49141e2a137
Content-Type: application/json
```

```json
{
  "device_id": "uuid-cua-thiet-bi",
  "credential": "credential-da-cap-mot-lan"
}
```

JWT ký bằng `DEVICE_TOKEN_SECRET` (server vẫn nhận tên cũ `DEVICE_JWT_SECRET` để tương thích), hạn 5 phút. Gửi các header sau cho API thiết bị đã xác thực:

```http
Authorization: Bearer <device-access-token>
X-Device-Id: <device-uuid>
```

Mỗi request ghi dữ liệu cần thêm timestamp mới và nonce mới (ít nhất 16 ký tự). Sai lệch đồng hồ tối đa 90 giây. API auth rate limited. Token gắn với fingerprint của credential hash nên bị vô hiệu khi credential được xoay hoặc thiết bị bị deactivate.

### 3. Đồng bộ quyền và enrollment

`GET /device/sync?since_version=12` trả `permission_version`, thời gian server, quyền hiện hành và danh sách trạng thái enrollment `{ id, user_id, status }`. Không trả face template hoặc ảnh. Nếu version không đổi, response đặt `not_modified=true` nhưng vẫn gửi trạng thái enrollment để thiết bị reconcile các yêu cầu mới/đã thu hồi.

Thiết bị phải lưu quyền có version và fail-closed khi cache quá hạn. Mặc định `expires_at` sau 300 giây; giới hạn cấu hình 30–900 giây qua `DEVICE_OFFLINE_MAX_AGE_SECONDS`. Hết hạn cache hoặc mất khả năng xác minh thì không mở cửa.

### 4. Heartbeat và access event

- `POST /device/heartbeat`, body tùy chọn `{ "firmware_version": "1.0.0", "door_state": "locked" }`; cập nhật `last_seen_at`, firmware và trạng thái cửa được thiết bị báo (trạng thái maintenance được giữ nguyên). `door_state` nhận `locked`, `unlocked` hoặc `unknown`.
- `POST /device/events` yêu cầu `Idempotency-Key` mới. Body chỉ nhận `user_id`, `decision`, `confidence` (0–1), `reason`, `occurred_at`.
- Backend xác minh user/device/permission/enrollment. Quyền từ chối đang hiệu lực được ưu tiên hơn quyền cho phép; enrollment `completed` theo đúng device là bắt buộc.
- Thiết bị báo `allowed` không đồng nghĩa backend sẽ ghi `allowed`. Backend lưu `denied` và reason có cấu trúc nếu policy không hợp lệ.
- `snapshot_path` không được nhận từ device; không upload dữ liệu sinh trắc học.

Ví dụ request:

```http
POST /api/device/events
Authorization: Bearer <device-access-token>
X-Device-Id: <device-uuid>
X-Device-Timestamp: 1793790000
X-Device-Nonce: 48a4c8f5a49141e2a138
Idempotency-Key: event-uuid-hoac-random-id
Content-Type: application/json
```

```json
{
  "user_id": "uuid-nguoi-dung",
  "decision": "allowed",
  "confidence": 0.94,
  "occurred_at": "2026-11-04T09:00:00Z"
}
```

`occurred_at` tối đa lệch 5 phút. Nếu key đã dùng trước đó cho cùng device, API trả event hiện có mà không sửa nhật ký.

### 5. Lệnh và enrollment

- `GET /device/commands/pending` trả command pending/sent chưa hết hạn. Lệnh unlock/lock hết hạn sau 30 giây; restart/sync sau 120 giây. Lệnh `sent` có thể được giao lại, firmware bắt buộc lưu `command.id` và chỉ thực thi mỗi ID một lần. Mỗi thiết bị chỉ có thể có một lệnh khóa/mở chưa có kết quả.
- Enum trạng thái database hiện có `pending`, `sent`, `acknowledged`, `failed`, `expired`; không có trạng thái `processing`. `sent` nghĩa là thiết bị đã lấy lệnh ít nhất một lần và đang chờ kết quả; `expired` là timeout.
- Thiết bị được xem là online khi heartbeat còn mới hơn `DEVICE_OFFLINE_THRESHOLD_SECONDS` (mặc định 120, giới hạn 30–900 giây). Monitor sẽ chuyển thiết bị stale sang `offline`; máy chủ chỉ xếp lệnh unlock khi thiết bị `online` và heartbeat còn trong ngưỡng này.
- Sau khi xử lý, gửi `POST /device/commands/:id/ack` với `status: acknowledged|failed`. `acknowledged` chỉ được ghi khi thiết bị xác nhận đã thực thi; tạo command không có nghĩa cửa đã mở.
- Lệnh điều khiển từ web dùng `POST /devices/:id/commands` với `{ "command": "unlock" }` hoặc `{ "command": "lock" }`. Cả hai chỉ được xếp hàng khi thiết bị online; server không tự gửi lại lệnh khi chưa rõ kết quả.
- Firmware cần nhận command `lock`, thực thi khóa cửa và ACK sau khi phần cứng hoàn tất. Gửi `door_state` trong heartbeat để web hiển thị trạng thái khóa/mở vật lý được báo gần nhất. Nếu chưa có cảm biến trạng thái, gửi `unknown` thay vì suy đoán.
- `POST /device/enrollments/:id/result` nhận `completed|failed`. Chỉ thiết bị đã gắn enrollment mới cập nhật được kết quả. Backend không nhận template sinh trắc học.

### Timestamp/nonce và triển khai nhiều instance

Nonce hiện được giữ trong Map của Node process với TTL 3 phút. Đây là chống phát lại cho một instance; nhiều instance/restart cần Redis hoặc store dùng chung. Idempotency key ở `access_events`, khóa giao dịch cho lệnh khóa/mở và cập nhật trạng thái command/enrollment bằng RPC bổ sung lớp chống trùng bền vững.

## Database/RLS

Các migration tạo `audit_logs` (RLS bật, không có policy cho browser) và RPC `SECURITY DEFINER` giới hạn execute cho `service_role`. RPC dùng transaction cho grant/thu hồi permission, tăng version, tạo/revoke enrollment, tạo device/command và ACK. Migration `202611160001_door_state_and_lock_command.sql` thêm cột `devices.door_state`, thời điểm báo trạng thái và enum lệnh `lock`, đồng thời ngăn xếp lệnh khóa/mở trùng khi kết quả trước chưa rõ. Chỉ apply migration còn thiếu theo thứ tự sau khi review; ứng dụng không tự chạy SQL.

Secret Key có quyền vượt qua RLS, do đó Express phải tiếp tục kiểm tra role và resource trên mọi route. Policies của các bảng hiện có chưa thể xác nhận từ schema export; hãy xuất `pg_policies` từ Supabase để review trước production.
