#pragma once
#include <stdint.h>

// Symmetric per-output-channel int8 weight-only representation; activations
// remain float32. This is NOT a full W8A8 quantization or ESP-DL model.
struct QuantLayerDef {
  const int8_t *weights;
  const float *scales;
  const float *biases;
  int inputChannels;
  int outputChannels;
  int kernel;
};

static constexpr int PALM_ROI_SIDE = 64;
static constexpr int PALM_EMBED = 512;
static constexpr int PALM_CLASSES = 4;
