#pragma once
#include <Arduino.h>

// =============================================================================
// 1. CAU HINH WI-FI & BACKEND (GIU NGUYEN TU Firmware.ino)
// =============================================================================
static const char WIFI_SSID[] = "Top1tg";
static const char WIFI_PASSWORD[] = "87654321";

// Co /api o cuoi, vi du: https://api.example.com/api
static const char API_BASE_URL[] = "https://web-control-esp32-cam.onrender.com/api";
static const char DEVICE_ID[] = "9cb7ac34-adfd-4785-ae43-023e321d2dcb";
static const char DEVICE_CREDENTIAL[] = "T6iY_T_zQMbD-0_K0Rq4B-Mz-O65MkZLBtvhOi2CvmU";
static const char FIRMWARE_VERSION[] = "2.1.0";

// Chung chi Root CA (PEM) xac thuc server HTTPS
static const char ROOT_CA_CERT[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG
A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv
b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw
MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i
YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT
aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ
jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp
xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp
1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG
snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ
U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8
9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E
BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B
AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz
yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE
38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP
AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad
DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME
HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==
-----END CERTIFICATE-----
)PEM";

// =============================================================================
// 2. PLACEHOLDER ANH XA USER_ID (UUID TREN WEB / SUPABASE access_users)
// =============================================================================
// Dien UUID cua nguoi dung tu trang Quan tri Web (muc Nguoi dung -> Chi tiet,
// hoac cot id trong bang access_users tren Supabase).
//
// Vi du dinh dang UUID hop le: "550e8400-e29b-41d4-a716-446655440000"
// Giu nguyen "PASTE_..." doi voi vi tri chua su dung (vi du chi dung 2/4 ban tay).

// UUID dai dien khi mo hinh khuon mat F2 nhan dien lop "chu_nha"
static const char FACE_OWNER_USER_ID[] = "9010b218-0941-428e-bd97-26bf77107fa4";

// UUID tuong ung 4 lop cua mo hinh long ban tay F1: person_01 .. person_04
static const char *const PALM_USER_IDS[4] = {
  "0a4682c3-f78d-4027-8abb-a29b6af37176", // person_01
  "cc8a631d-805b-4557-9045-07b57e50b775", // person_02
  "da46b856-15de-4ad6-a01e-a65253a46058", // person_03
  "f71c6566-6b9e-4e01-90d2-1ba46f94f829"  // person_04
};

// Khi mat Wi-Fi / khong ket noi duoc Backend:
// true = cho phep mo cua cuc bo (5s) neu sinh trac hoc hop le.
static constexpr bool ALLOW_OFFLINE_LOCAL_UNLOCK = true;

// Neu true: cho phep mo cua cuc bo ngay ca khi ban CHUA dien UUID vao
// FACE_OWNER_USER_ID / PALM_USER_IDS (chi nen bat tam khi test ban mach).
// Mac dinh false de tranh lop person_XX chua dung mo nham cua.
static constexpr bool ALLOW_UNMAPPED_LOCAL_UNLOCK = false;

// Gui su kien denied (nguoi la / ban tay khong khop) len nhat ky Web
static constexpr bool REPORT_DENIED_EVENTS = true;

// =============================================================================
// 3. CHAN KET NOI PHAN CUNG (ESP32-CAM AI-THINKER)
// =============================================================================
// Luu y: GPIO 13, 14, 15 dung chung bus the nho microSD -> KHONG cam the SD.
#define PIN_KHOA      13
#define PIN_LED_XANH  14
#define PIN_LED_DO    15
#define PIN_FLASH      4   // Den flash onboard (0 = tat)

static constexpr uint8_t DOOR_UNLOCK_LEVEL = LOW;   // LOW = mo khoa
static constexpr uint8_t DOOR_LOCK_LEVEL   = HIGH;  // HIGH = dong khoa
static constexpr uint8_t LED_ON_LEVEL      = HIGH;
static constexpr uint8_t LED_OFF_LEVEL     = LOW;
static constexpr uint8_t FLASH_DUTY        = 0;     // 0 = tat, 10..40 = sang nhe

// Chan camera AI-Thinker OV2640
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

// =============================================================================
// 4. THAM SO NHAN DIEN & THOI GIAN HOAT DONG
// =============================================================================
// --- F2: Khuon mat (Edge Impulse) ---
static constexpr float NGUONG_CHU_NHA  = 0.85f;  // Xac suat lop chu_nha
static constexpr float NGUONG_NGUOI_LA = 0.60f;  // Xac suat lop nguoi_la
static constexpr int   CUA_SO_MAT      = 3;      // Xet toi da 3 khung lien tiep
static constexpr int   CAN_DAT_MAT     = 2;      // Can >= 2 khung dat chu_nha
static constexpr uint32_t FACE_CONFIRM_TIMEOUT_MS = 3500;

// --- F1: Long ban tay (PalmAlgorithm) ---
static constexpr float NGUONG_BAN_TAY        = 0.15f; // Nguong cosine similarity (best >= 0.15)
static constexpr float NGUONG_MARGIN_BAN_TAY = 0.00f; // Tuy chon them khoang cach voi nguoi dung nhi (0 = tat)

// Nguong phat hien co vat the / ban tay de kich hoat F1 khi tu dong quet:
static constexpr float NGUONG_KHONG_CO_AI_DE_QUET_TAY = 0.75f; // khong_co_ai < 0.75 -> co doi tuong
static constexpr int   NGUONG_CHUYEN_DONG_ROI         = 14;    // Chenh lech do sang trung binh vung 96x96

// --- Thoi gian khoa/mo & bao loi ---
static constexpr uint32_t THOI_GIAN_MO_SINH_TRAC_MS = 5000;   // Mo 5s khi nhan dien mat/tay
static constexpr uint32_t THOI_GIAN_MO_TU_XA_MS     = 30000;  // Tu khoa sau 30s neu web khong gui lock
static constexpr uint32_t THOI_GIAN_BAO_LOI_MS      = 1500;   // Den do bao loi 1.5s
static constexpr uint32_t THOI_GIAN_TAM_KHOA_MS     = 60000;  // Tam khoa 60s neu sai lien tiep
static constexpr int      SO_LAN_SAI_TOI_DA         = 5;
static constexpr uint32_t SCAN_IDLE_DELAY_MS        = 150;

// --- Mang & Dong bo Backend ---
static constexpr uint32_t HEARTBEAT_MS     = 30000;
static constexpr uint32_t COMMAND_POLL_MS  = 1000;
static constexpr uint32_t SYNC_INTERVAL_MS = 60000;
static constexpr uint32_t AUTH_RETRY_MS    = 60000;
static constexpr uint32_t WIFI_RETRY_MS    = 15000;
static constexpr int      WDT_TIMEOUT_S    = 90;
