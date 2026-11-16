/*
 * Result.ino - Khoa cua thong minh ESP32-CAM AI-Thinker
 * Tich hop:
 *   - F2: Nhan dien khuon mat (Edge Impulse: chu_nha / nguoi_la / khong_co_ai)
 *   - F1: Nhan dien long ban tay (PalmAlgorithm: person_01 .. person_04)
 *   - Web Control: Ket noi REST API HTTPS backend (unlock, lock, sync_permissions, restart, heartbeat, events)
 *
 * Arduino IDE:
 *   - Board            : AI Thinker ESP32-CAM (ESP32 core 2.0.x hoac 3.x)
 *   - PSRAM            : Enabled
 *   - Partition Scheme : Huge APP (3MB No OTA/1MB SPIFFS) -- hoac Custom neu vuot 3 MB
 *   - Thu vien can cai : ArduinoJson (6.x hoac 7.x) + thu vien Edge Impulse cua ban
 */

// ====== Doi dong nay neu thu vien Edge Impulse cua ban co ten khac ======
#include <KhoaCua_inferencing.h>
// =========================================================================

#include "edge-impulse-sdk/dsp/image/image.hpp"
#include "PalmAlgorithm.h"
#include "config.h"
#include "app_types.h"

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_camera.h>
#include <img_converters.h>
#include <esp_heap_caps.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <time.h>
#include <math.h>
#include <ctype.h>
#include <strings.h>

#if !defined(EI_CLASSIFIER_SENSOR) || EI_CLASSIFIER_SENSOR != EI_CLASSIFIER_SENSOR_CAMERA
#error "Thu vien Edge Impulse nay khong phai mo hinh anh (camera)."
#endif
#if defined(EI_CLASSIFIER_OBJECT_DETECTION) && EI_CLASSIFIER_OBJECT_DETECTION == 1
#error "Can mo hinh PHAN LOAI anh (Transfer Learning Images), khong phai Object Detection."
#endif

// Stack cho loopTask (chay AI + camera); networkTask se dung stack rieng 16 KB
SET_LOOP_TASK_STACK_SIZE(12 * 1024);

static constexpr int CAM_W = 320;
static constexpr int CAM_H = 240;
static constexpr int PALM_FRAME_W = 160;
static constexpr int PALM_FRAME_H = 120;
// PALM_ROI_SIDE (64) da duoc dinh nghia trong model_spec.h
static constexpr int PALM_ROI_X = 32;
static constexpr int PALM_ROI_Y = 12;
static constexpr int PALM_ROI_SOURCE_SIDE = 96;
static constexpr int SO_DONG_NHAT_KY = 50;

// ----------------- Dong bo da luong (FreeRTOS) -----------------
static SemaphoreHandle_t stateMutex = nullptr;
static SemaphoreHandle_t reportDoneSem = nullptr;
static QueueHandle_t deniedQueue = nullptr;
static TaskHandle_t networkTaskHandle = nullptr;

static DoorMode doorMode = DOOR_LOCKED;
static uint32_t doorUnlockAtMs = 0;
static uint32_t doorUnlockDurationMs = 0;
static bool doorStateDirty = false;

static TrangThai trangThai = TT_CHO;
static uint32_t mocThoiGian = 0;
static int soLanSai = 0;
static uint32_t soLanKhoiDong = 0;
static bool cheDoThu = false;
static bool forcePalmTest = false;
static bool forceFaceTest = false;

// Trang thai mang (so huu boi networkTask, doc an toan qua stateMutex)
static Preferences prefsDoor;
static String accessToken;
static uint32_t tokenUntil = 0;
static uint32_t lastAuthAttempt = 0;
static uint32_t lastHeartbeat = 0;
static uint32_t lastCommandPoll = 0;
static uint32_t lastSyncMs = 0;
static uint32_t lastWifiAttempt = 0;
static uint32_t ntpStartMs = 0;
static bool authAttempted = false;
static bool configurationReady = false;
static bool clockReady = false;
static bool ntpStarted = false;
static bool onlineReady = false;
static bool sharedClockReady = false;
static bool sharedTokenReady = false;
static bool palmScanning = false;
static long lastPermissionVersion = -1;
static long sharedPermissionVersion = -1;

static PendingAccessReport pendingReport;

// ----------------- Bo dem camera & AI (PSRAM) -----------------
static uint8_t *anhRgb = nullptr;          // 320x240x3 BGR888 trong PSRAM
static uint8_t *gray160x120 = nullptr;     // 160x120 grayscale trong PSRAM
static uint8_t *refGray160x120 = nullptr;  // Nen tinh 160x120 trong PSRAM
static bool hasRefGray = false;
static int quietEmptyCount = 0;
static uint8_t palmRoi[PALM_ROI_SIDE * PALM_ROI_SIDE];

static int idxChuNha = -1, idxNguoiLa = -1, idxKhongCoAi = -1;

// Cua so truot cho xac nhan khuon mat
static KetQuaMat cuaSoMat[CUA_SO_MAT];
static int soKhungMat = 0;
static int viTriMat = 0;

// =====================================================================
//                         TIEN ICH KIEM TRA CAU HINH
// =====================================================================
static bool isValidUuid(const char *s) {
  if (!s || strlen(s) != 36) return false;
  for (int i = 0; i < 36; i++) {
    char c = s[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else {
      if (!isxdigit((unsigned char)c)) return false;
    }
  }
  char ver = s[14];
  if (ver < '1' || ver > '8') return false;
  char var = (char)tolower((unsigned char)s[19]);
  if (var != '8' && var != '9' && var != 'a' && var != 'b') return false;
  return true;
}

static bool isMappedLocalUser(const char *userId) {
  if (!isValidUuid(userId)) return false;
  if (isValidUuid(FACE_OWNER_USER_ID) && strcasecmp(userId, FACE_OWNER_USER_ID) == 0) return true;
  for (int i = 0; i < 4; i++) {
    if (isValidUuid(PALM_USER_IDS[i]) && strcasecmp(userId, PALM_USER_IDS[i]) == 0) return true;
  }
  return false;
}

static bool configured() {
  String ca = ROOT_CA_CERT;
  return String(WIFI_SSID).indexOf("YOUR_") < 0 &&
         String(WIFI_PASSWORD).indexOf("YOUR_") < 0 &&
         String(API_BASE_URL).startsWith("https://") &&
         String(API_BASE_URL).indexOf("YOUR_") < 0 &&
         isValidUuid(DEVICE_ID) &&
         String(DEVICE_CREDENTIAL).indexOf("PASTE_") < 0 &&
         strlen(DEVICE_CREDENTIAL) >= 32 &&
         ca.indexOf("-----BEGIN CERTIFICATE-----") >= 0 &&
         ca.indexOf("-----END CERTIFICATE-----") >= 0;
}

// =====================================================================
//                       DIEU KHIEN PHAN CUNG & CUA
// =====================================================================
static void datFlash(uint8_t duty) {
  if (duty == 0) {
    pinMode(PIN_FLASH, OUTPUT);
    digitalWrite(PIN_FLASH, LOW);
    return;
  }
  static bool daGan = false;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  if (!daGan) { ledcAttach(PIN_FLASH, 5000, 8); daGan = true; }
  ledcWrite(PIN_FLASH, duty);
#else
  if (!daGan) { ledcSetup(7, 5000, 8); ledcAttachPin(PIN_FLASH, 7); daGan = true; }
  ledcWrite(7, duty);
#endif
}

static void lockMutex() {
  if (stateMutex) xSemaphoreTake(stateMutex, portMAX_DELAY);
}

static void unlockMutex() {
  if (stateMutex) xSemaphoreGive(stateMutex);
}

static const char *getDoorStateStr() {
  lockMutex();
  const char *st = (doorMode == DOOR_LOCKED) ? "locked" : "unlocked";
  unlockMutex();
  return st;
}

static bool isDoorUnlocked() {
  lockMutex();
  bool unlocked = (doorMode != DOOR_LOCKED);
  unlockMutex();
  return unlocked;
}

static bool isSystemOnline() {
  lockMutex();
  bool ok = onlineReady;
  unlockMutex();
  return ok;
}

static void setDoorUnlocked(bool isRemote, const char *sourceLabel) {
  lockMutex();
  digitalWrite(PIN_KHOA, DOOR_UNLOCK_LEVEL);
  doorMode = isRemote ? DOOR_UNLOCKED_REMOTE : DOOR_UNLOCKED_BIO;
  doorUnlockAtMs = millis();
  doorUnlockDurationMs = isRemote ? THOI_GIAN_MO_TU_XA_MS : THOI_GIAN_MO_SINH_TRAC_MS;
  doorStateDirty = true;
  if (isRemote) {
    soLanSai = 0;
    trangThai = TT_MO_KHOA;
    mocThoiGian = doorUnlockAtMs;
  }
  digitalWrite(PIN_LED_DO, LED_OFF_LEVEL);
  digitalWrite(PIN_LED_XANH, LED_ON_LEVEL);
  unlockMutex();

  Serial.printf("[DOOR] MO KHOA (%s) - tu dong khoa sau %lu ms\n",
                sourceLabel ? sourceLabel : "?",
                (unsigned long)(isRemote ? THOI_GIAN_MO_TU_XA_MS : THOI_GIAN_MO_SINH_TRAC_MS));
}

static void setDoorLocked(const char *reasonLabel) {
  lockMutex();
  digitalWrite(PIN_KHOA, DOOR_LOCK_LEVEL);
  doorMode = DOOR_LOCKED;
  doorStateDirty = true;
  digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
  unlockMutex();

  Serial.printf("[DOOR] DONG KHOA (%s)\n", reasonLabel ? reasonLabel : "?");
}

static void tickDoorAutoLock() {
  bool autoLocked = false;
  bool wasRemote = false;

  lockMutex();
  if (doorMode != DOOR_LOCKED &&
      (uint32_t)(millis() - doorUnlockAtMs) >= doorUnlockDurationMs) {
    wasRemote = (doorMode == DOOR_UNLOCKED_REMOTE);
    digitalWrite(PIN_KHOA, DOOR_LOCK_LEVEL);
    doorMode = DOOR_LOCKED;
    doorStateDirty = true;
    digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
    trangThai = TT_CHO;
    mocThoiGian = millis();
    autoLocked = true;
  }
  unlockMutex();

  if (autoLocked) {
    Serial.println(wasRemote
                       ? "[DOOR] Tu dong khoa lai sau 30s khong tac dong tu Web."
                       : "[DOOR] Da tu dong khoa lai sau 5s.");
  }
}

static void dungLai(const char *loi, bool coTheKhoiDongLai) {
  digitalWrite(PIN_KHOA, DOOR_LOCK_LEVEL);
  digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
  Serial.println(loi);
  uint32_t batDau = millis();
  while (true) {
    digitalWrite(PIN_LED_DO, LED_ON_LEVEL);
    delay(150);
    digitalWrite(PIN_LED_DO, LED_OFF_LEVEL);
    delay(150);
    if (coTheKhoiDongLai && millis() - batDau > 10000) ESP.restart();
  }
}

// =====================================================================
//                    NHAT KY NVS (vong tron 50 dong)
// =====================================================================
static void ghiNhatKy(const char *ketQua, float diem) {
  String dong = String("boot#") + soLanKhoiDong +
                " t=" + (millis() / 1000) + "s" +
                " kq=" + ketQua +
                " score=" + String(diem, 2);
  Serial.println("[NHAT KY] " + dong);

  Preferences p;
  if (!p.begin("nhatky", false)) return;
  uint32_t idx = p.getUInt("idx", 0);
  char khoa[8];
  snprintf(khoa, sizeof(khoa), "d%u", (unsigned)(idx % SO_DONG_NHAT_KY));
  p.putString(khoa, dong);
  p.putUInt("idx", idx + 1);
  p.end();
}

static void inNhatKy() {
  Preferences p;
  if (!p.begin("nhatky", true)) {
    Serial.println("(nhat ky trong)");
    return;
  }
  uint32_t idx = p.getUInt("idx", 0);
  uint32_t n = (idx < (uint32_t)SO_DONG_NHAT_KY) ? idx : (uint32_t)SO_DONG_NHAT_KY;
  Serial.println("------ NHAT KY ------");
  for (uint32_t i = idx - n; i < idx; i++) {
    char khoa[8];
    snprintf(khoa, sizeof(khoa), "d%u", (unsigned)(i % SO_DONG_NHAT_KY));
    Serial.println(p.getString(khoa, ""));
  }
  if (n == 0) Serial.println("(nhat ky trong)");
  Serial.println("---------------------");
  p.end();
}

static void xoaNhatKy() {
  Preferences p;
  if (p.begin("nhatky", false)) {
    p.clear();
    p.end();
  }
  Serial.println("Da xoa nhat ky");
}

// =====================================================================
//                         MANG & BACKEND API
// =====================================================================
static String randomHex(size_t count) {
  uint8_t bytes[16];
  if (count > sizeof(bytes)) count = sizeof(bytes);
  esp_fill_random(bytes, count);
  const char digits[] = "0123456789abcdef";
  String out;
  out.reserve(count * 2);
  for (size_t i = 0; i < count; ++i) {
    out += digits[bytes[i] >> 4];
    out += digits[bytes[i] & 0x0f];
  }
  return out;
}

static String utcNow() {
  time_t now = time(nullptr);
  if (now < 1760000000) return "";
  struct tm t;
  gmtime_r(&now, &t);
  char value[25];
  strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(value);
}

static Reply apiRequest(const char *method, const String &path,
                        const String &body = "", bool auth = false,
                        bool fresh = false, const char *extraName = nullptr,
                        const String &extraValue = "") {
  Reply reply;
  if (WiFi.status() != WL_CONNECTED || !clockReady) return reply;

  WiFiClientSecure tls;
  tls.setCACert(ROOT_CA_CERT);
  tls.setHandshakeTimeout(30);

  HTTPClient http;
  if (!http.begin(tls, String(API_BASE_URL) + path)) return reply;
  http.setTimeout(60000); // Cho Render wake up neu dang ngu
  http.addHeader("Accept", "application/json");

  if (auth) {
    if (!accessToken.length()) {
      http.end();
      return reply;
    }
    http.addHeader("Authorization", "Bearer " + accessToken);
    http.addHeader("X-Device-Id", DEVICE_ID);
  }
  if (fresh) {
    http.addHeader("X-Device-Timestamp", String((unsigned long)time(nullptr)));
    http.addHeader("X-Device-Nonce", randomHex(12));
  }
  if (extraName) http.addHeader(extraName, extraValue);
  if (!strcmp(method, "POST")) http.addHeader("Content-Type", "application/json");

  reply.status = !strcmp(method, "GET") ? http.GET() : http.POST(body);
  if (reply.status > 0) reply.body = http.getString();
  if (reply.status <= 0) {
    char error[96] = {0};
    tls.lastError(error, sizeof(error));
    Serial.printf("[HTTPS] %s (%d)\n", error, reply.status);
  }
  http.end();

  if (auth && reply.status == 401) {
    accessToken = "";
    tokenUntil = 0;
  }
  return reply;
}

static bool ensureToken() {
  if (accessToken.length() && (int32_t)(millis() - tokenUntil) < 0) return true;
  accessToken = "";
  if (authAttempted && millis() - lastAuthAttempt < AUTH_RETRY_MS) return false;
  authAttempted = true;
  lastAuthAttempt = millis();

  StaticJsonDocument<384> body;
  body["device_id"] = DEVICE_ID;
  body["credential"] = DEVICE_CREDENTIAL;
  String json;
  serializeJson(body, json);

  Reply reply = apiRequest("POST", "/device/auth", json, false, true);
  if (reply.status != 200) {
    Serial.printf("[AUTH] HTTP %d\n", reply.status);
    return false;
  }

  DynamicJsonDocument response(2048);
  DeserializationError error = deserializeJson(response, reply.body);
  JsonVariant token = response["data"]["access_token"];
  if (error || !(response["success"] | false) || !token.is<const char *>() ||
      !token.as<const char *>()[0]) {
    Serial.printf("[AUTH] Phan hoi khong hop le; JSON=%s\n", error ? error.c_str() : "none");
    return false;
  }

  accessToken = token.as<const char *>();
  uint32_t seconds = response["data"]["expires_in"] | 300UL;
  tokenUntil = millis() + (seconds > 30 ? seconds - 30 : seconds) * 1000UL;
  Serial.println("[AUTH] Da lay token thiet bi thanh cong.");
  return true;
}

static bool sendHeartbeat() {
  StaticJsonDocument<160> body;
  body["firmware_version"] = FIRMWARE_VERSION;
  body["door_state"] = getDoorStateStr();
  String json;
  serializeJson(body, json);
  Reply reply = apiRequest("POST", "/device/heartbeat", json, true, true);
  if (reply.status == 200) return true;
  Serial.printf("[HEARTBEAT] HTTP %d\n", reply.status);
  return false;
}

static bool acknowledge(const String &id, bool ok, const char *errMsg = nullptr) {
  StaticJsonDocument<320> body;
  body["status"] = ok ? "acknowledged" : "failed";
  JsonObject result = body.createNestedObject("response");
  result["firmware_version"] = FIRMWARE_VERSION;
  result["door_state"] = getDoorStateStr();
  if (lastPermissionVersion >= 0) {
    result["permission_version"] = lastPermissionVersion;
  }
  if (!ok) {
    body["error_message"] = (errMsg && *errMsg) ? errMsg : "Lenh thuc thi that bai";
  }
  String json;
  serializeJson(body, json);
  Reply reply = apiRequest("POST", "/device/commands/" + id + "/ack", json, true, true);
  return reply.status == 200;
}

static bool completeEnrollment(const char *enrollmentId) {
  if (!enrollmentId || !*enrollmentId) return false;
  StaticJsonDocument<64> body;
  body["status"] = "completed";
  String json;
  serializeJson(body, json);
  Reply reply = apiRequest("POST", String("/device/enrollments/") + enrollmentId + "/result",
                           json, true, true);
  if (reply.status == 200) {
    Serial.printf("[ENROLL] Da xac nhan completed cho enrollment %s\n", enrollmentId);
    return true;
  }
  Serial.printf("[ENROLL] Xac nhan %s that bai HTTP %d\n", enrollmentId, reply.status);
  return false;
}

static bool syncFromServer(bool forceFull) {
  String path = "/device/sync";
  if (!forceFull && lastPermissionVersion >= 0) {
    path += "?since_version=" + String(lastPermissionVersion);
  }
  Reply reply = apiRequest("GET", path, "", true, false);
  if (reply.status != 200) {
    Serial.printf("[SYNC] HTTP %d\n", reply.status);
    return false;
  }

  size_t docSize = reply.body.length() * 2 + 2048;
  if (docSize > 32768) docSize = 32768;
  DynamicJsonDocument doc(docSize);
  DeserializationError err = deserializeJson(doc, reply.body);
  if (err || !(doc["success"] | false)) {
    Serial.printf("[SYNC] Loi parse JSON: %s\n", err ? err.c_str() : "success=false");
    return false;
  }

  lastPermissionVersion = doc["permission_version"] | lastPermissionVersion;
  lockMutex();
  sharedPermissionVersion = lastPermissionVersion;
  unlockMutex();
  bool notModified = doc["not_modified"] | false;
  int permCount = doc["permissions"].is<JsonArray>() ? (int)doc["permissions"].as<JsonArray>().size() : -1;
  int enrollCount = doc["enrollments"].is<JsonArray>() ? (int)doc["enrollments"].as<JsonArray>().size() : 0;

  if (!notModified || forceFull) {
    Serial.printf("[SYNC] version=%ld, not_modified=%s, permissions=%d, enrollments=%d\n",
                  lastPermissionVersion, notModified ? "true" : "false", permCount, enrollCount);
  }

  // Tu dong xac nhan completed cho cac yeu cau enrollment pending khop voi UUID da gan trong firmware
  if (doc["enrollments"].is<JsonArray>()) {
    for (JsonObject en : doc["enrollments"].as<JsonArray>()) {
      const char *enId = en["id"] | "";
      const char *uId = en["user_id"] | "";
      const char *st = en["status"] | "";
      if (strcmp(st, "pending") == 0 && *enId && *uId) {
        if (isMappedLocalUser(uId)) {
          completeEnrollment(enId);
        } else {
          Serial.printf("[SYNC] Enrollment pending %s (user=%s) chua duoc gan trong config.h\n",
                        enId, uId);
        }
      }
    }
  }
  return true;
}

static void pollCommands() {
  Reply reply = apiRequest("GET", "/device/commands/pending", "", true, false);
  if (reply.status != 200) return;

  size_t docSize = reply.body.length() * 2 + 2048;
  if (docSize > 16384) docSize = 16384;
  DynamicJsonDocument data(docSize);
  if (deserializeJson(data, reply.body) || !(data["success"] | false) ||
      !data["data"].is<JsonArray>()) return;

  for (JsonObject item : data["data"].as<JsonArray>()) {
    const char *idValue = item["id"] | "";
    const char *nameValue = item["command"] | "";
    const char *status = item["status"] | "";
    if (!*idValue || (strcmp(status, "pending") && strcmp(status, "sent"))) continue;

    String command(nameValue);
    String id(idValue);

    if (command != "lock" && command != "unlock" &&
        command != "sync_permissions" && command != "restart") {
      continue;
    }

    if (prefsDoor.getString("command_id", "") == id) {
      acknowledge(id, prefsDoor.getBool("command_ok", false));
      continue;
    }

    // Luu ID truoc khi thuc thi de tranh chay lap lai neu server gui lai
    prefsDoor.putString("command_id", id);
    prefsDoor.putBool("command_ok", false);

    if (command == "unlock") {
      setDoorUnlocked(true, "Web unlock");
      prefsDoor.putBool("command_ok", true);
      acknowledge(id, true);
      sendHeartbeat();
      lastHeartbeat = millis();
    } else if (command == "lock") {
      setDoorLocked("Web lock");
      prefsDoor.putBool("command_ok", true);
      acknowledge(id, true);
      sendHeartbeat();
      lastHeartbeat = millis();
    } else if (command == "sync_permissions") {
      Serial.println("[CMD] Thuc thi sync_permissions tu Web...");
      bool ok = syncFromServer(true);
      prefsDoor.putBool("command_ok", ok);
      acknowledge(id, ok, ok ? nullptr : "Dong bo quyen that bai");
      lastSyncMs = millis();
    } else if (command == "restart") {
      Serial.println("[CMD] Nhan lenh restart tu Web -> ACK va khoi dong lai...");
      prefsDoor.putBool("command_ok", true);
      acknowledge(id, true);
      delay(300);
      digitalWrite(PIN_KHOA, DOOR_LOCK_LEVEL);
      ESP.restart();
    }
  }
}

static bool sendAccessEventOnline(const char *userId, const char *decision,
                                  float confidence, const char *reason,
                                  bool &outAllowed, char *outReason, size_t outReasonLen) {
  outAllowed = false;
  if (outReason && outReasonLen) outReason[0] = '\0';

  String occurredAt = utcNow();
  if (!occurredAt.length() || !ensureToken()) return false;

  float conf = confidence;
  if (conf < 0.0f) conf = 0.0f;
  if (conf > 1.0f) conf = 1.0f;

  StaticJsonDocument<384> body;
  if (userId && *userId && isValidUuid(userId)) {
    body["user_id"] = userId;
  } else {
    body["user_id"] = nullptr;
  }
  body["decision"] = decision;
  body["confidence"] = conf;
  if (reason && *reason) body["reason"] = reason;
  body["occurred_at"] = occurredAt;

  String json;
  serializeJson(body, json);

  Reply reply = apiRequest("POST", "/device/events", json, true, true,
                           "Idempotency-Key", randomHex(16));
  if (reply.status == 401 && ensureToken()) {
    reply = apiRequest("POST", "/device/events", json, true, true,
                       "Idempotency-Key", randomHex(16));
  }
  if (reply.status == 403) {
    if (outReason && outReasonLen) snprintf(outReason, outReasonLen, "device_disabled");
    return true; // Server tu choi ro rang
  }
  if (reply.status != 200 && reply.status != 201) {
    Serial.printf("[EVENT] HTTP %d\n", reply.status);
    return false; // Loi mang / server -> cho phep fallback offline neu bat
  }

  DynamicJsonDocument result(1024);
  if (deserializeJson(result, reply.body)) return false;
  const char *finalDecision = result["data"]["decision"] | "denied";
  const char *srvReason = result["data"]["reason"] | "";
  outAllowed = (strcmp(finalDecision, "allowed") == 0);
  if (outReason && outReasonLen) {
    snprintf(outReason, outReasonLen, "%s", srvReason);
  }
  return true;
}

// Task mang chay doc lap tren Core 0 de khong bi chan boi qua trinh AI nhan dien
static void networkTask(void *param) {
  (void)param;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttempt = millis();
  lastHeartbeat = millis() - HEARTBEAT_MS;
  lastCommandPoll = millis() - COMMAND_POLL_MS;
  lastSyncMs = millis() - SYNC_INTERVAL_MS;

  for (;;) {
    tickDoorAutoLock();

    lockMutex();
    if (palmScanning && doorMode == DOOR_LOCKED) {
      digitalWrite(PIN_LED_XANH, ((millis() / 200) % 2) ? LED_ON_LEVEL : LED_OFF_LEVEL);
    }
    unlockMutex();

    if (WiFi.status() != WL_CONNECTED) {
      lockMutex();
      onlineReady = false;
      sharedClockReady = false;
      sharedTokenReady = false;
      bool hasPending = pendingReport.pending;
      if (hasPending) {
        pendingReport.pending = false;
        pendingReport.onlineConfirmed = false;
        pendingReport.backendAllowed = false;
      }
      unlockMutex();

      accessToken = "";
      clockReady = false;
      ntpStarted = false;

      if (hasPending && reportDoneSem) xSemaphoreGive(reportDoneSem);
      if (deniedQueue) {
        DeniedEventItem drop;
        while (xQueueReceive(deniedQueue, &drop, 0) == pdTRUE) {}
      }

      if (millis() - lastWifiAttempt >= WIFI_RETRY_MS) {
        lastWifiAttempt = millis();
        Serial.println("[WIFI] Dang thu ket noi lai Wi-Fi...");
        WiFi.disconnect(false);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    if (!clockReady) {
      if (!ntpStarted) {
        configTime(0, 0, "pool.ntp.org", "time.google.com");
        ntpStarted = true;
        ntpStartMs = millis();
      }
      if (time(nullptr) >= 1760000000) {
        clockReady = true;
        lockMutex();
        sharedClockReady = true;
        unlockMutex();
        Serial.println("[NTP] Da dong bo thoi gian UTC.");
      } else {
        if (millis() - ntpStartMs >= 20000) ntpStarted = false;
        lockMutex();
        onlineReady = false;
        sharedClockReady = false;
        sharedTokenReady = false;
        bool hasPending = pendingReport.pending;
        if (hasPending) {
          pendingReport.pending = false;
          pendingReport.onlineConfirmed = false;
          pendingReport.backendAllowed = false;
        }
        unlockMutex();
        if (hasPending && reportDoneSem) xSemaphoreGive(reportDoneSem);
        vTaskDelay(pdMS_TO_TICKS(100));
        continue;
      }
    }

    if (!ensureToken()) {
      lockMutex();
      onlineReady = false;
      sharedTokenReady = false;
      bool hasPending = pendingReport.pending;
      if (hasPending) {
        pendingReport.pending = false;
        pendingReport.onlineConfirmed = false;
        pendingReport.backendAllowed = false;
      }
      unlockMutex();
      if (hasPending && reportDoneSem) xSemaphoreGive(reportDoneSem);
      vTaskDelay(pdMS_TO_TICKS(150));
      continue;
    }

    lockMutex();
    onlineReady = true;
    sharedClockReady = true;
    sharedTokenReady = true;
    bool hasPending = pendingReport.pending;
    char reqUserId[40] = {0};
    float reqConf = 0.0f;
    if (hasPending) {
      snprintf(reqUserId, sizeof(reqUserId), "%s", pendingReport.userId);
      reqConf = pendingReport.confidence;
    }
    unlockMutex();

    // Uu tien 1: Xac minh yeu cau mo cua sinh trac hoc tu loopTask
    if (hasPending) {
      bool allowed = false;
      char srvReason[64] = {0};
      bool confirmed = sendAccessEventOnline(reqUserId, "allowed", reqConf, nullptr,
                                             allowed, srvReason, sizeof(srvReason));
      lockMutex();
      pendingReport.pending = false;
      pendingReport.onlineConfirmed = confirmed;
      pendingReport.backendAllowed = allowed;
      snprintf(pendingReport.reason, sizeof(pendingReport.reason), "%s", srvReason);
      unlockMutex();
      if (reportDoneSem) xSemaphoreGive(reportDoneSem);
    }

    // Uu tien 2: Gui cac su kien denied trong hang doi (khong chan UI/AI)
    if (deniedQueue) {
      DeniedEventItem dItem;
      while (xQueueReceive(deniedQueue, &dItem, 0) == pdTRUE) {
        bool dummyAllowed = false;
        char dummyReason[64] = {0};
        sendAccessEventOnline(nullptr, "denied", dItem.confidence, dItem.reason,
                              dummyAllowed, dummyReason, sizeof(dummyReason));
        tickDoorAutoLock();
      }
    }

    uint32_t now = millis();

    // Uu tien 3: Poll lenh dieu khien tu Web moi 1 giay
    if (now - lastCommandPoll >= COMMAND_POLL_MS) {
      pollCommands();
      lastCommandPoll = millis();
    }

    // Uu tien 4: Heartbeat ngay khi trang thai cua thay doi hoac moi 30 giay
    lockMutex();
    bool dirty = doorStateDirty;
    doorStateDirty = false;
    unlockMutex();

    if (dirty || (now - lastHeartbeat >= HEARTBEAT_MS)) {
      if (!sendHeartbeat() && dirty) {
        // Neu gui that bai thi thu lai o chu ky ke tiep
        lockMutex();
        doorStateDirty = true;
        unlockMutex();
      }
      lastHeartbeat = millis();
    }

    // Uu tien 5: Dong bo quyen & enrollment dinh ky
    if (now - lastSyncMs >= SYNC_INTERVAL_MS) {
      syncFromServer(false);
      lastSyncMs = millis();
    }

    vTaskDelay(pdMS_TO_TICKS(40));
  }
}

// =====================================================================
//                       CAMERA & TIEN XU LY ANH
// =====================================================================
static bool khoiTaoCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk  = XCLK_GPIO_NUM;
  c.pin_pclk  = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href  = HREF_GPIO_NUM;
  c.pin_sscb_sda = SIOD_GPIO_NUM;
  c.pin_sscb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn  = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size   = FRAMESIZE_QVGA; // 320x240
  c.jpeg_quality = 12;
  c.fb_count     = 2;
  c.fb_location  = CAMERA_FB_IN_PSRAM;
  c.grab_mode    = CAMERA_GRAB_LATEST;

  if (esp_camera_init(&c) != ESP_OK) return false;

  for (int i = 0; i < 5; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) esp_camera_fb_return(fb);
    delay(50);
  }
  return true;
}

static uint8_t bilinearAt(const uint8_t *image, float x, float y) {
  int x0 = (int)floorf(x);
  int y0 = (int)floorf(y);
  if (x0 < 0) x0 = 0;
  if (x0 > PALM_FRAME_W - 2) x0 = PALM_FRAME_W - 2;
  if (y0 < 0) y0 = 0;
  if (y0 > PALM_FRAME_H - 2) y0 = PALM_FRAME_H - 2;
  const int x1 = x0 + 1;
  const int y1 = y0 + 1;
  float a = x - x0;
  float b = y - y0;
  if (a < 0.0f) a = 0.0f; else if (a > 1.0f) a = 1.0f;
  if (b < 0.0f) b = 0.0f; else if (b > 1.0f) b = 1.0f;

  const float v00 = image[y0 * PALM_FRAME_W + x0];
  const float v01 = image[y0 * PALM_FRAME_W + x1];
  const float v10 = image[y1 * PALM_FRAME_W + x0];
  const float v11 = image[y1 * PALM_FRAME_W + x1];
  const float value = (1.0f - a) * (1.0f - b) * v00 + a * (1.0f - b) * v01 +
                      (1.0f - a) * b * v10 + a * b * v11;
  int rounded = (int)lroundf(value);
  if (rounded < 0) rounded = 0;
  if (rounded > 255) rounded = 255;
  return (uint8_t)rounded;
}

// Chup 1 khung QVGA -> giai nen BGR888 -> tao gray160x120 & palmRoi -> cat cho F2
static bool chupVaChuanBiKhung(int *outRoiMad = nullptr) {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return false;
  if (fb->width != CAM_W || fb->height != CAM_H) {
    esp_camera_fb_return(fb);
    return false;
  }
  bool ok = fmt2rgb888(fb->buf, fb->len, fb->format, anhRgb);
  esp_camera_fb_return(fb);
  if (!ok) return false;

  // 1. Chuyen 320x240 BGR888 -> 160x120 anh xam (de dung cho F1 PalmAlgorithm + phat hien chuyen dong)
  for (int gy = 0; gy < PALM_FRAME_H; gy++) {
    const uint8_t *row0 = anhRgb + ((size_t)(gy * 2) * CAM_W) * 3;
    const uint8_t *row1 = row0 + CAM_W * 3;
    for (int gx = 0; gx < PALM_FRAME_W; gx++) {
      const uint8_t *p00 = row0 + gx * 6;
      const uint8_t *p01 = p00 + 3;
      const uint8_t *p10 = row1 + gx * 6;
      const uint8_t *p11 = p10 + 3;
      int b = (p00[0] + p01[0] + p10[0] + p11[0]) >> 2;
      int g = (p00[1] + p01[1] + p10[1] + p11[1]) >> 2;
      int r = (p00[2] + p01[2] + p10[2] + p11[2]) >> 2;
      int yVal = (77 * r + 150 * g + 29 * b + 128) >> 8;
      if (yVal < 0) yVal = 0; else if (yVal > 255) yVal = 255;
      gray160x120[gy * PALM_FRAME_W + gx] = (uint8_t)yVal;
    }
  }

  // 2. Tinh do thay doi vung trung tam 96x96 so voi nen tinh
  int mad = 0;
  if (hasRefGray) {
    uint32_t diffSum = 0;
    for (int y = PALM_ROI_Y; y < PALM_ROI_Y + PALM_ROI_SOURCE_SIDE; y++) {
      const int rowOff = y * PALM_FRAME_W;
      for (int x = PALM_ROI_X; x < PALM_ROI_X + PALM_ROI_SOURCE_SIDE; x++) {
        int d = (int)gray160x120[rowOff + x] - (int)refGray160x120[rowOff + x];
        if (d < 0) d = -d;
        diffSum += (uint32_t)d;
      }
    }
    mad = (int)(diffSum / (PALM_ROI_SOURCE_SIDE * PALM_ROI_SOURCE_SIDE));
  } else {
    memcpy(refGray160x120, gray160x120, PALM_FRAME_W * PALM_FRAME_H);
    hasRefGray = true;
  }
  if (outRoiMad) *outRoiMad = mad;

  // 3. Cat 96x96 -> 64x64 cho PalmAlgorithm (giong het CameraTest.ino)
  for (int y = 0; y < PALM_ROI_SIDE; ++y) {
    for (int x = 0; x < PALM_ROI_SIDE; ++x) {
      const float sourceX = PALM_ROI_X + (x + 0.5f) * PALM_ROI_SOURCE_SIDE / PALM_ROI_SIDE - 0.5f;
      const float sourceY = PALM_ROI_Y + (y + 0.5f) * PALM_ROI_SOURCE_SIDE / PALM_ROI_SIDE - 0.5f;
      palmRoi[y * PALM_ROI_SIDE + x] = bilinearAt(gray160x120, sourceX, sourceY);
    }
  }

  // 4. Cat giua + resize anhRgb cho Edge Impulse (lam SAU cung vi ghi de in-place)
  ei::image::processing::crop_and_interpolate_rgb888(
      anhRgb, CAM_W, CAM_H,
      anhRgb, EI_CLASSIFIER_INPUT_WIDTH, EI_CLASSIFIER_INPUT_HEIGHT);
  return true;
}

static void capNhatNenTinh(bool epBuoc) {
  if (!hasRefGray || epBuoc) {
    memcpy(refGray160x120, gray160x120, PALM_FRAME_W * PALM_FRAME_H);
    hasRefGray = true;
    return;
  }
  // Cap nhat tu tu (EMA) khi khung canh dang yen tinh de thich nghi anh sang
  for (int i = 0; i < PALM_FRAME_W * PALM_FRAME_H; i++) {
    refGray160x120[i] = (uint8_t)(((int)refGray160x120[i] * 3 + (int)gray160x120[i] + 2) >> 2);
  }
}

// =====================================================================
//                    F2 (KHUON MAT) & F1 (BAN TAY)
// =====================================================================
static int timLop(const char *ten, bool batBuoc = true) {
  for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
    if (strcmp(ei_classifier_inferencing_categories[i], ten) == 0) return (int)i;
  }
  if (batBuoc) Serial.printf("KHONG TIM THAY LOP \"%s\" trong mo hinh Edge Impulse!\n", ten);
  return -1;
}

static int layDuLieuAnh(size_t offset, size_t length, float *out) {
  size_t px = offset * 3;
  for (size_t i = 0; i < length; i++) {
    out[i] = (anhRgb[px + 2] << 16) + (anhRgb[px + 1] << 8) + anhRgb[px];
    px += 3;
  }
  return 0;
}

static bool chayKhuonMat(KetQuaMat &kq) {
  ei::signal_t signal;
  signal.total_length = EI_CLASSIFIER_INPUT_WIDTH * EI_CLASSIFIER_INPUT_HEIGHT;
  signal.get_data = &layDuLieuAnh;

  ei_impulse_result_t result = {0};
  EI_IMPULSE_ERROR err = run_classifier(&signal, &result, false);
  if (err != EI_IMPULSE_OK) {
    Serial.printf("[F2] Loi run_classifier (%d)\n", err);
    return false;
  }

  kq.pChuNha = result.classification[idxChuNha].value;
  kq.pNguoiLa = (idxNguoiLa >= 0) ? result.classification[idxNguoiLa].value : 0.0f;
  kq.pKhongCoAi = result.classification[idxKhongCoAi].value;
  return true;
}

static bool chayLongBanTay(PalmPrediction &kq) {
  esp_task_wdt_reset();
  bool ok = palmPredict(palmRoi, kq);
  esp_task_wdt_reset();
  return ok && kq.valid;
}

static void xoaCuaSoMat() { soKhungMat = 0; viTriMat = 0; }

static void themKhungMat(const KetQuaMat &kq) {
  cuaSoMat[viTriMat] = kq;
  viTriMat = (viTriMat + 1) % CUA_SO_MAT;
  if (soKhungMat < CUA_SO_MAT) soKhungMat++;
}

static int demChuNha() {
  int n = 0;
  for (int i = 0; i < soKhungMat; i++) if (cuaSoMat[i].pChuNha >= NGUONG_CHU_NHA) n++;
  return n;
}

static int demNguoiLa() {
  int n = 0;
  for (int i = 0; i < soKhungMat; i++) if (cuaSoMat[i].pNguoiLa >= NGUONG_NGUOI_LA) n++;
  return n;
}

// =====================================================================
//                XAC MINH VOI BACKEND VA DIEU KHIEN CUA
// =====================================================================
static void guiSuKienTuChoi(const char *reason, float confidence) {
  if (!REPORT_DENIED_EVENTS || !deniedQueue) return;
  DeniedEventItem item;
  snprintf(item.reason, sizeof(item.reason), "%s", (reason && *reason) ? reason : "denied");
  item.confidence = constrain(confidence, 0.0f, 1.0f);
  xQueueSend(deniedQueue, &item, 0);
}

static void baoThatBai(const char *lyDo, float score) {
  lockMutex();
  if (doorMode != DOOR_LOCKED) {
    unlockMutex();
    return;
  }
  soLanSai++;
  int lanSaiHienTai = soLanSai;
  digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
  digitalWrite(PIN_LED_DO, LED_ON_LEVEL);
  trangThai = TT_THAT_BAI;
  mocThoiGian = millis();
  unlockMutex();

  ghiNhatKy(lyDo, score);
  Serial.printf("[DENY] That bai (%s) - sai %d/%d lan\n", lyDo, lanSaiHienTai, SO_LAN_SAI_TOI_DA);
}

static bool xacMinhVaMoKhoa(const char *kieuNhanDien, const char *userId, float confidence) {
  bool uuidHopLe = isValidUuid(userId);
  if (!uuidHopLe) {
    Serial.printf("[CONFIG] %s khop nhung UUID chua duoc dien trong config.h (%s)\n",
                  kieuNhanDien, userId ? userId : "null");
    if (!ALLOW_UNMAPPED_LOCAL_UNLOCK) {
      baoThatBai("chua_cau_hinh_uuid", confidence);
      return false;
    }
    setDoorUnlocked(false, kieuNhanDien);
    soLanSai = 0;
    ghiNhatKy(kieuNhanDien, confidence);
    trangThai = TT_MO_KHOA;
    mocThoiGian = millis();
    return true;
  }

  // Neu dang mat mang / chua san sang backend -> mo cua cuc bo (neu cho phep)
  if (!isSystemOnline()) {
    if (ALLOW_OFFLINE_LOCAL_UNLOCK) {
      Serial.printf("[OFFLINE] Mat Wi-Fi/Backend -> cho phep mo cuc bo (%s)\n", kieuNhanDien);
      setDoorUnlocked(false, kieuNhanDien);
      soLanSai = 0;
      ghiNhatKy(kieuNhanDien, confidence);
      trangThai = TT_MO_KHOA;
      mocThoiGian = millis();
      return true;
    } else {
      baoThatBai("offline_blocked", confidence);
      return false;
    }
  }

  // Gui yeu cau qua networkTask de kiem tra quyen hien hanh tren Backend
  while (xSemaphoreTake(reportDoneSem, 0) == pdTRUE) {} // xoa tin hieu cu neu co

  lockMutex();
  pendingReport.pending = true;
  pendingReport.onlineConfirmed = false;
  pendingReport.backendAllowed = false;
  snprintf(pendingReport.userId, sizeof(pendingReport.userId), "%s", userId);
  pendingReport.reason[0] = '\0';
  pendingReport.confidence = constrain(confidence, 0.0f, 1.0f);
  unlockMutex();

  esp_task_wdt_reset();
  bool signaled = (xSemaphoreTake(reportDoneSem, pdMS_TO_TICKS(65000)) == pdTRUE);
  esp_task_wdt_reset();

  if (isDoorUnlocked()) {
    // Co the Web vua gui lenh unlock trong luc cho
    trangThai = TT_MO_KHOA;
    return true;
  }

  bool onlineConfirmed = false;
  bool backendAllowed = false;
  char srvReason[64] = {0};

  if (signaled) {
    lockMutex();
    onlineConfirmed = pendingReport.onlineConfirmed;
    backendAllowed = pendingReport.backendAllowed;
    snprintf(srvReason, sizeof(srvReason), "%s", pendingReport.reason);
    unlockMutex();
  }

  if (onlineConfirmed) {
    if (backendAllowed) {
      Serial.printf("[BACKEND] Cho phep mo cua (%s, user=%s, conf=%.2f)\n",
                    kieuNhanDien, userId, confidence);
      setDoorUnlocked(false, kieuNhanDien);
      soLanSai = 0;
      ghiNhatKy(kieuNhanDien, confidence);
      trangThai = TT_MO_KHOA;
      mocThoiGian = millis();
      return true;
    } else {
      Serial.printf("[BACKEND] TU CHOI mo cua (%s, ly do=%s)\n",
                    kieuNhanDien, *srvReason ? srvReason : "denied");
      baoThatBai(*srvReason ? srvReason : "backend_denied", confidence);
      return false;
    }
  }

  // Khong lien lac duoc Backend (rot mang / timeout giua chung)
  if (ALLOW_OFFLINE_LOCAL_UNLOCK) {
    Serial.printf("[OFFLINE] Backend khong phan hoi -> mo cuc bo (%s)\n", kieuNhanDien);
    setDoorUnlocked(false, kieuNhanDien);
    soLanSai = 0;
    ghiNhatKy(kieuNhanDien, confidence);
    trangThai = TT_MO_KHOA;
    mocThoiGian = millis();
    return true;
  }

  baoThatBai("backend_timeout", confidence);
  return false;
}

// =====================================================================
//                         LENH SERIAL MONITOR
// =====================================================================
static void inTrangThaiHeThong() {
  lockMutex();
  bool ntpOk = sharedClockReady;
  bool tokOk = sharedTokenReady;
  bool onlOk = onlineReady;
  long syncVer = sharedPermissionVersion;
  const char *doorStr = (doorMode == DOOR_LOCKED) ? "locked" : "unlocked";
  unlockMutex();

  Serial.println("------ TRANG THAI HE THONG ------");
  Serial.printf("WiFi=%s | IP=%s | NTP=%s | Token=%s | Online=%s\n",
                WiFi.status() == WL_CONNECTED ? "OK" : "OFF",
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "-",
                ntpOk ? "OK" : "NO",
                tokOk ? "OK" : "NO",
                onlOk ? "YES" : "NO");
  Serial.printf("Door(GPIO13)=%s | SyncVer=%ld | FreeHeap=%u | FreePSRAM=%u\n",
                doorStr,
                syncVer,
                (unsigned)ESP.getFreeHeap(),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
  Serial.printf("UUID chu_nha (F2) : %s\n", isValidUuid(FACE_OWNER_USER_ID) ? FACE_OWNER_USER_ID : "[CHUA DIEN]");
  for (int i = 0; i < 4; i++) {
    Serial.printf("UUID person_%02d (F1): %s\n", i + 1,
                  isValidUuid(PALM_USER_IDS[i]) ? PALM_USER_IDS[i] : "[CHUA DIEN]");
  }
  Serial.println("---------------------------------");
}

static void docLenhSerial() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\r' || ch == '\n' || ch == ' ') continue;
    if (ch == 't' || ch == 'T') {
      cheDoThu = !cheDoThu;
      datFlash(cheDoThu ? FLASH_DUTY : 0);
      Serial.printf("[TEST] Che do THU: %s\n", cheDoThu ? "BAT (khong mo khoa)" : "TAT");
    } else if (ch == 's' || ch == 'S') {
      forcePalmTest = true;
    } else if (ch == 'f' || ch == 'F') {
      forceFaceTest = true;
    } else if (ch == 'l' || ch == 'L') {
      inNhatKy();
    } else if (ch == 'x' || ch == 'X') {
      xoaNhatKy();
    } else if (ch == 'i' || ch == 'I') {
      inTrangThaiHeThong();
    }
  }
}

// =====================================================================
//                              SETUP / LOOP
// =====================================================================
void setup() {
  // Giu khoa DONG ngay lap tuc khi cap dien (HIGH = dong khoa)
  digitalWrite(PIN_KHOA, DOOR_LOCK_LEVEL);
  pinMode(PIN_KHOA, OUTPUT);
  digitalWrite(PIN_KHOA, DOOR_LOCK_LEVEL);

  pinMode(PIN_LED_XANH, OUTPUT);
  digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
  pinMode(PIN_LED_DO, OUTPUT);
  digitalWrite(PIN_LED_DO, LED_OFF_LEVEL);
  datFlash(0);

  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== KHOA CUA ESP32-CAM: KHUON MAT (F2) + BAN TAY (F1) + WEB ===");

  Preferences pref;
  pref.begin("khoacua", false);
  soLanKhoiDong = pref.getUInt("boot", 0) + 1;
  pref.putUInt("boot", soLanKhoiDong);
  pref.end();

  prefsDoor.begin("door", false);

  stateMutex = xSemaphoreCreateMutex();
  reportDoneSem = xSemaphoreCreateBinary();
  deniedQueue = xQueueCreate(4, sizeof(DeniedEventItem));

  // Kiem tra mo hinh F2 (Edge Impulse)
  Serial.print("[F2] Cac lop Edge Impulse:");
  for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
    Serial.printf(" %s", ei_classifier_inferencing_categories[i]);
  }
  Serial.println();

  idxChuNha = timLop("chu_nha");
  idxKhongCoAi = timLop("khong_co_ai");
  idxNguoiLa = timLop("nguoi_la", false);
  if (idxChuNha < 0 || idxKhongCoAi < 0) {
    dungLai("[LOI] Mo hinh Edge Impulse phai co lop chu_nha va khong_co_ai.", false);
  }
  if (idxNguoiLa < 0) {
    Serial.println("[CANH BAO] Mo hinh F2 chua co lop nguoi_la.");
  }

  // Kiem tra mo hinh F1 (PalmAlgorithm)
  Serial.printf("[F1] PalmAlgorithm model=%s | nguong cosine=%.2f\n",
                palmHasTrainedModel() ? "OK" : "THIEU", NGUONG_BAN_TAY);
  if (!palmHasTrainedModel()) {
    dungLai("[LOI] Khong tim thay trong so PalmAlgorithm (generated_model.h).", false);
  }

  // Cap phat bo dem PSRAM
  if (!psramFound()) dungLai("[LOI] Khong thay PSRAM: hay bat Tools > PSRAM > Enabled", false);
  anhRgb = (uint8_t *)ps_malloc(CAM_W * CAM_H * 3);
  gray160x120 = (uint8_t *)ps_malloc(PALM_FRAME_W * PALM_FRAME_H);
  refGray160x120 = (uint8_t *)ps_malloc(PALM_FRAME_W * PALM_FRAME_H);
  if (!anhRgb || !gray160x120 || !refGray160x120) {
    dungLai("[LOI] Khong cap phat duoc bo dem anh trong PSRAM", true);
  }

  if (!khoiTaoCamera()) {
    dungLai("[LOI] Khoi tao camera that bai (kiem tra cap camera va nguon 5V)", true);
  }

  // Khoi dong task mang tren Core 0
  configurationReady = configured();
  if (!configurationReady) {
    Serial.println("[CONFIG] Cau hinh Wi-Fi/API/DEVICE chua hop le -> chi chay che do cuc bo.");
  } else {
    xTaskCreatePinnedToCore(networkTask, "net_task", 16 * 1024, nullptr, 1, &networkTaskHandle, 0);
  }

  // Watchdog tren loopTask (Core 1)
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cauHinhWdt = {
    .timeout_ms = (uint32_t)WDT_TIMEOUT_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  esp_task_wdt_reconfigure(&cauHinhWdt);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);

  Serial.printf("[READY] Khoi dong lan #%u | F2=%dx%d | F1=64x64\n",
                (unsigned)soLanKhoiDong, EI_CLASSIFIER_INPUT_WIDTH, EI_CLASSIFIER_INPUT_HEIGHT);
  inTrangThaiHeThong();
  Serial.println("Lenh Serial: 't'=che do thu | 's'=test ban tay | 'f'=test mat | 'i'=trang thai | 'l'=nhat ky | 'x'=xoa");
  ghiNhatKy("khoi_dong", 1.0f);
}

void loop() {
  esp_task_wdt_reset();
  tickDoorAutoLock();
  docLenhSerial();

  // Dong bo trang thai neu Web da mo khoa hoac da khoa tu xa
  if (isDoorUnlocked()) {
    if (trangThai != TT_MO_KHOA) {
      trangThai = TT_MO_KHOA;
      mocThoiGian = millis();
    }
  } else if (trangThai == TT_MO_KHOA) {
    trangThai = TT_CHO;
    mocThoiGian = millis();
    xoaCuaSoMat();
    digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
  }

  // Test thu cong qua Serial ('s' = palm, 'f' = face)
  if (forcePalmTest || forceFaceTest) {
    int mad = 0;
    if (chupVaChuanBiKhung(&mad)) {
      if (forceFaceTest) {
        KetQuaMat kq;
        if (chayKhuonMat(kq)) {
          Serial.printf("[TEST-F2] chu_nha=%.2f nguoi_la=%.2f khong_co_ai=%.2f mad=%d\n",
                        kq.pChuNha, kq.pNguoiLa, kq.pKhongCoAi, mad);
        }
      }
      if (forcePalmTest) {
        PalmPrediction kqTay;
        if (chayLongBanTay(kqTay)) {
          Serial.printf("[TEST-F1] person_%02d best=%.4f margin=%.4f (%lums) | [%.3f, %.3f, %.3f, %.3f]\n",
                        kqTay.person, kqTay.best, kqTay.margin, kqTay.latencyMs,
                        kqTay.cosine[0], kqTay.cosine[1], kqTay.cosine[2], kqTay.cosine[3]);
        } else {
          Serial.println("[TEST-F1] Nhan dien long ban tay that bai");
        }
      }
    }
    forcePalmTest = false;
    forceFaceTest = false;
  }

  uint32_t daQua = millis() - mocThoiGian;

  switch (trangThai) {
    case TT_MO_KHOA:
      digitalWrite(PIN_LED_DO, LED_OFF_LEVEL);
      digitalWrite(PIN_LED_XANH, LED_ON_LEVEL);
      delay(40);
      break;

    case TT_THAT_BAI:
      digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
      digitalWrite(PIN_LED_DO, LED_ON_LEVEL);
      if (daQua >= THOI_GIAN_BAO_LOI_MS) {
        digitalWrite(PIN_LED_DO, LED_OFF_LEVEL);
        if (soLanSai >= SO_LAN_SAI_TOI_DA) {
          Serial.println("[LOCKOUT] Sai qua nhieu lan: TAM KHOA 60 giay.");
          ghiNhatKy("tam_khoa", 0.0f);
          trangThai = TT_TAM_KHOA;
          mocThoiGian = millis();
        } else {
          trangThai = TT_CHO;
          mocThoiGian = millis();
        }
      }
      delay(20);
      break;

    case TT_TAM_KHOA:
      digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
      digitalWrite(PIN_LED_DO, ((millis() / 500) % 2) ? LED_ON_LEVEL : LED_OFF_LEVEL);
      if (daQua >= THOI_GIAN_TAM_KHOA_MS) {
        soLanSai = 0;
        digitalWrite(PIN_LED_DO, LED_OFF_LEVEL);
        Serial.println("[LOCKOUT] Het thoi gian tam khoa, tiep tuc quet tu dong.");
        trangThai = TT_CHO;
        mocThoiGian = millis();
      }
      delay(40);
      break;

    case TT_CHO: {
      digitalWrite(PIN_LED_DO, LED_OFF_LEVEL);
      if (cheDoThu) {
        int mad = 0;
        if (chupVaChuanBiKhung(&mad)) {
          KetQuaMat kq;
          if (chayKhuonMat(kq)) {
            Serial.printf("[THU-F2] chu_nha=%.2f nguoi_la=%.2f khong_co_ai=%.2f mad=%d\n",
                          kq.pChuNha, kq.pNguoiLa, kq.pKhongCoAi, mad);
          }
          PalmPrediction kqTay;
          if (chayLongBanTay(kqTay)) {
            Serial.printf("[THU-F1] person_%02d best=%.4f margin=%.4f (%lums)\n",
                          kqTay.person, kqTay.best, kqTay.margin, kqTay.latencyMs);
          }
        }
        delay(200);
        break;
      }

      int roiMad = 0;
      if (!chupVaChuanBiKhung(&roiMad)) {
        delay(100);
        break;
      }

      KetQuaMat kqMat;
      if (!chayKhuonMat(kqMat)) {
        delay(100);
        break;
      }

      // 1) Khuon mat co dau hieu chu_nha -> xac nhan nhanh cua so 2/3 khung
      if (kqMat.pChuNha >= NGUONG_CHU_NHA) {
        xoaCuaSoMat();
        themKhungMat(kqMat);
        float maxFace = kqMat.pChuNha;
        uint32_t startConfirm = millis();
        datFlash(FLASH_DUTY);

        while (millis() - startConfirm < FACE_CONFIRM_TIMEOUT_MS) {
          esp_task_wdt_reset();
          tickDoorAutoLock();
          if (isDoorUnlocked()) break;
          digitalWrite(PIN_LED_XANH, ((millis() / 200) % 2) ? LED_ON_LEVEL : LED_OFF_LEVEL);

          if (demChuNha() >= CAN_DAT_MAT) {
            datFlash(0);
            Serial.printf("[F2] Xac nhan khuon mat chu_nha (score=%.2f)\n", maxFace);
            xacMinhVaMoKhoa("face_chu_nha", FACE_OWNER_USER_ID, maxFace);
            break;
          }
          if (demNguoiLa() >= CAN_DAT_MAT) break;

          if (chupVaChuanBiKhung(nullptr)) {
            KetQuaMat nextMat;
            if (chayKhuonMat(nextMat)) {
              themKhungMat(nextMat);
              if (nextMat.pChuNha > maxFace) maxFace = nextMat.pChuNha;
            }
          }
        }
        datFlash(0);
        if (!isDoorUnlocked() && trangThai == TT_CHO) {
          digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
        }
        break;
      }

      // 2) Khong phai chu_nha ngay lap tuc -> kiem tra co doi tuong / ban tay / nguoi la khong
      const bool coDoiTuong = (kqMat.pNguoiLa >= NGUONG_NGUOI_LA) ||
                              (kqMat.pKhongCoAi < NGUONG_KHONG_CO_AI_DE_QUET_TAY) ||
                              (roiMad >= NGUONG_CHUYEN_DONG_ROI);

      if (!coDoiTuong) {
        digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
        quietEmptyCount = 0;
        capNhatNenTinh(false);
        delay(SCAN_IDLE_DELAY_MS);
        break;
      }

      // Co nguoi/ban tay truoc camera: chay F1 (PalmAlgorithm) tren cung khung hinh da chup
      Serial.printf("[SCAN] Phat hien doi tuong (nguoi_la=%.2f khong_co_ai=%.2f mad=%d) -> quet ban tay F1...\n",
                    kqMat.pNguoiLa, kqMat.pKhongCoAi, roiMad);
      lockMutex();
      palmScanning = true;
      unlockMutex();
      datFlash(FLASH_DUTY);

      PalmPrediction kqTay;
      bool palmOk = chayLongBanTay(kqTay);
      datFlash(0);
      lockMutex();
      palmScanning = false;
      if (doorMode == DOOR_LOCKED) digitalWrite(PIN_LED_XANH, LED_OFF_LEVEL);
      unlockMutex();

      if (isDoorUnlocked()) break; // Web vua mo khoa trong luc quet

      if (palmOk) {
        Serial.printf("[F1] person_%02d best=%.4f margin=%.4f (%lums)\n",
                      kqTay.person, kqTay.best, kqTay.margin, kqTay.latencyMs);
      }

      if (palmOk && kqTay.best >= NGUONG_BAN_TAY && kqTay.margin >= NGUONG_MARGIN_BAN_TAY) {
        int idx = kqTay.person - 1;
        const char *palmUid = (idx >= 0 && idx < 4) ? PALM_USER_IDS[idx] : "";
        char label[24];
        snprintf(label, sizeof(label), "palm_person_%02d", kqTay.person);
        xacMinhVaMoKhoa(label, palmUid, kqTay.best);
        break;
      }

      // Ban tay khong dat nguong: kiem tra xem co phai nguoi la hay chi la anh sang thay doi khi phong trong
      if (kqMat.pNguoiLa >= NGUONG_NGUOI_LA) {
        // Lay nhanh them 1 khung F2 de tranh bao sai do chuyen dong mo
        bool vanLaNguoiLa = true;
        if (chupVaChuanBiKhung(nullptr)) {
          KetQuaMat kqXacNhan;
          if (chayKhuonMat(kqXacNhan)) {
            if (kqXacNhan.pChuNha >= NGUONG_CHU_NHA) {
              xacMinhVaMoKhoa("face_chu_nha", FACE_OWNER_USER_ID, kqXacNhan.pChuNha);
              break;
            }
            if (kqXacNhan.pNguoiLa < NGUONG_NGUOI_LA && kqXacNhan.pKhongCoAi >= NGUONG_KHONG_CO_AI_DE_QUET_TAY) {
              vanLaNguoiLa = false;
            }
          }
        }
        if (vanLaNguoiLa && !isDoorUnlocked()) {
          guiSuKienTuChoi("nguoi_la", kqMat.pNguoiLa);
          baoThatBai("nguoi_la", kqMat.pNguoiLa);
        }
      } else if (kqMat.pKhongCoAi < NGUONG_KHONG_CO_AI_DE_QUET_TAY) {
        // Co vat the / ban tay la nhung khong dat nguong 0.15
        float bestScore = palmOk ? kqTay.best : 0.0f;
        guiSuKienTuChoi("unknown_palm", bestScore);
        baoThatBai("ban_tay_khong_khop", bestScore);
      } else if (kqMat.pKhongCoAi >= 0.85f) {
        // F2 xac nhan chac chan khong co ai (anh sang thay doi) -> cap nhat lai nen tinh
        quietEmptyCount++;
        if (quietEmptyCount >= 2) {
          capNhatNenTinh(true);
          quietEmptyCount = 0;
        }
      }
      break;
    }
  }
}
