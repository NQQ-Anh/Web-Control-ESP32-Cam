#pragma once
#include <Arduino.h>

enum DoorMode {
  DOOR_LOCKED = 0,
  DOOR_UNLOCKED_BIO,
  DOOR_UNLOCKED_REMOTE
};

enum TrangThai {
  TT_CHO = 0,
  TT_MO_KHOA,
  TT_THAT_BAI,
  TT_TAM_KHOA
};

struct KetQuaMat {
  float pChuNha = 0.0f;
  float pNguoiLa = 0.0f;
  float pKhongCoAi = 0.0f;
};

struct Reply {
  int status = -1;
  String body;
};

struct PendingAccessReport {
  bool pending = false;
  bool onlineConfirmed = false;
  bool backendAllowed = false;
  char userId[40] = {0};
  char reason[64] = {0};
  float confidence = 0.0f;
};

struct DeniedEventItem {
  char reason[64] = {0};
  float confidence = 0.0f;
};
