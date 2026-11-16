#pragma once
#include <stdint.h>
#include "model_spec.h"

struct PalmPrediction {
  int person = 0; // 1-4, or zero if model not usable
  float cosine[PALM_CLASSES] = {0, 0, 0, 0};
  float best = -2.0f;
  float margin = -2.0f;
  unsigned long latencyMs = 0;
  bool valid = false;
};

bool palmHasTrainedModel();
// roi64: NEW 64x64 8-bit grayscale ROI data, row-major.
// Returns false on model missing, invalid ROI, OOM, or runtime failure.
// Does NOT authorize access; the caller must apply a validated policy.
bool palmPredict(const uint8_t *roi64, PalmPrediction &result);
