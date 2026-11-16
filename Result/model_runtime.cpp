#include <Arduino.h>
#include <esp_heap_caps.h>
#include <math.h>
#include <string.h>
#include <new>
#include "model_runtime.h"
#include "deflate_inflate.h"
#if __has_include("generated_model.h")
#include "generated_model.h"
#else
#include "generated_model.stub.h"
#endif

static int8_t* unpackWeights(const uint8_t *zData, size_t zLen, size_t rawLen) {
  if (!zData || zLen == 0 || rawLen == 0) return nullptr;
  void *buf = heap_caps_malloc(rawLen, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!buf && rawLen <= 16384) {
    buf = heap_caps_malloc(rawLen, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  }
  if (!buf) return nullptr;
  if (!inflateRaw(zData, zLen, (uint8_t*)buf, rawLen)) {
    heap_caps_free(buf);
    return nullptr;
  }
  return (int8_t*)buf;
}

static float* allocFloats(size_t count) {
  if (count == 0 || count > (SIZE_MAX / sizeof(float))) return nullptr;
  size_t bytes = count * sizeof(float);
  // Reserve extra internal SRAM for Wi-Fi/mbedTLS handshakes and camera DMA
  // while spilling larger feature maps cleanly to PSRAM.
  constexpr size_t INTERNAL_HEAP_RESERVE = 80 * 1024;
  constexpr size_t MAX_INTERNAL_TENSOR_BYTES = 128 * 1024;
  const uint32_t internalCaps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
  void *p = nullptr;
  if (bytes <= MAX_INTERNAL_TENSOR_BYTES) {
    size_t freeInternal = heap_caps_get_free_size(internalCaps);
    if (freeInternal > bytes + INTERNAL_HEAP_RESERVE)
      p = heap_caps_malloc(bytes, internalCaps);
  }
  if (!p) p = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!p) p = heap_caps_malloc(bytes, internalCaps);
  return (float*)p;
}
static void releaseFloats(float *p) { if (p) heap_caps_free(p); }

bool palmHasTrainedModel() {
#if PALM_MODEL_AVAILABLE
  return true;
#else
  return false;
#endif
}

#if PALM_MODEL_AVAILABLE
static void normalize512(float *v) {
  double sum=0;
  for (int i=0;i<PALM_EMBED;i++) sum += (double)v[i]*v[i];
  float denom = sqrtf((float)sum);
  if (denom<1e-12f) return;
  for (int i=0;i<PALM_EMBED;i++) v[i]/=denom;
}

// Exact NormSingleROI positive-mask rule from source project's preprocessing.py,
// applied after a source-specific 64x64 grayscale ROI has been produced.
static bool normalizeInput(const uint8_t *pixels, float *out) {
  double sum=0;
  int n=0;
  for(int i=0;i<4096;i++) {
    if(pixels[i]) { sum += pixels[i]/255.0; n++; }
  }
  if(n < 4) return false;
  double mean=sum/n, var=0;
  for(int i=0;i<4096;i++) if(pixels[i]) {
    double x=pixels[i]/255.0-mean;
    var+=x*x;
  }
  float stdValue=sqrtf((float)(var/(n-1))); // torch.std correction=1
  for(int i=0;i<4096;i++)
    out[i]=pixels[i] ? (float)((pixels[i]/255.0-mean)/(stdValue+1e-6f)):0.0f;
  return true;
}

struct Tensor {
  float *p=nullptr;
  int c=0,h=0,w=0;
};
static Tensor createTensor(int c,int h,int w) {
  Tensor t;
  t.p=allocFloats((size_t)c*h*w);
  if(t.p){t.c=c;t.h=h;t.w=w;}
  return t;
}
static void releaseTensor(Tensor &t) {
  releaseFloats(t.p); t=Tensor{};
}

// Streamed Gabor: 32 precomputed 15x15 trainable kernels, ReLU -> max across
// kernels. Produces ONE 64x64 response instead of a 32x64x64 tensor.
static Tensor streamedGabor(const Tensor &in) {
  if(!in.p||in.c!=1||in.w!=64||in.h!=64) return {};
  Tensor out=createTensor(1,64,64);
  if(!out.p) return {};
  memset(out.p,0,64*64*sizeof(float));
  constexpr int TILE_X=8;
  for(int g=0;g<32;g++) {
    const float *kernel=g_gabor_bank+g*225;
    for(int y=0;y<64;y++) {
      const int kyBegin = y < 7 ? 7-y : 0;
      const int kyEnd = y+7 >= 64 ? 64+7-y : 15;
      for(int tileX=0;tileX<64;tileX+=TILE_X) {
        float acc[TILE_X]={0};
        const int tileCount=(tileX+TILE_X<=64)?TILE_X:64-tileX;
        for(int ky=kyBegin;ky<kyEnd;ky++) {
          const float *row=in.p+(y+ky-7)*64;
          for(int kx=0;kx<15;kx++) {
            const int dx=kx-7;
            int xBegin=tileX;
            if(dx<0 && xBegin < -dx) xBegin=-dx;
            int xEnd=tileX+tileCount;
            if(dx>0 && xEnd > 64-dx) xEnd=64-dx;
            if(xBegin>=xEnd)continue;
            const float weight=kernel[ky*15+kx];
            const float *pixel=row+xBegin+dx;
            for(int x=xBegin;x<xEnd;x++) {
              acc[x-tileX]+=(*pixel++)*weight;
            }
          }
        }
        for(int x=0;x<tileCount;x++) {
          int index=y*64+tileX+x;
          if(acc[x]>out.p[index])out.p[index]=acc[x];
        }
      }
      if(!(y&15))yield();
    }
  }
  // Original model: Gabor -> ReLU -> CompetitivePool -> BN(1 channel).
  for(int i=0;i<4096;i++) {
    out.p[i]=out.p[i]*g_gbn_slope+g_gbn_bias;
  }
  return out;
}

// Conv + BatchNorm fused at EXPORT time, ReLU at runtime.
// Weight-only per-output-channel INT8: wfloat ~= q_weight * scales[oc].
// No external convolution scratch buffer; float32 activations in PSRAM.
static Tensor convolution(const Tensor &in,const QuantLayerDef &layer) {
  if(!in.p || in.c!=layer.inputChannels) return {};
  const int k=layer.kernel, radius=k/2,hw=in.h*in.w;
  Tensor out=createTensor(layer.outputChannels,in.h,in.w);
  if(!out.p)return {};

  // The exported backbone uses 3x3 convolutions and output channel counts
  // divisible by four. Compute four output channels over an 8-pixel spatial
  // tile so each input value and weight is reused before leaving the cache.
  // For each output pixel, ic/ky/kx accumulation order stays unchanged.
  if(k==3 && (layer.outputChannels&3)==0) {
    constexpr int OUTPUT_TILE=4;
    constexpr int TILE_X=8;
    const int weightsPerOutput=layer.inputChannels*9;
    for(int oc=0;oc<layer.outputChannels;oc+=OUTPUT_TILE) {
      const int8_t *weights0=layer.weights+(size_t)(oc+0)*weightsPerOutput;
      const int8_t *weights1=layer.weights+(size_t)(oc+1)*weightsPerOutput;
      const int8_t *weights2=layer.weights+(size_t)(oc+2)*weightsPerOutput;
      const int8_t *weights3=layer.weights+(size_t)(oc+3)*weightsPerOutput;
      const float scale0=layer.scales[oc+0], scale1=layer.scales[oc+1];
      const float scale2=layer.scales[oc+2], scale3=layer.scales[oc+3];
      const float bias0=layer.biases[oc+0], bias1=layer.biases[oc+1];
      const float bias2=layer.biases[oc+2], bias3=layer.biases[oc+3];
      float *out0=out.p+(size_t)(oc+0)*hw;
      float *out1=out.p+(size_t)(oc+1)*hw;
      float *out2=out.p+(size_t)(oc+2)*hw;
      float *out3=out.p+(size_t)(oc+3)*hw;

      for(int y=0;y<in.h;y++) {
        const int kyBegin=(y==0)?1:0;
        const int kyEnd=(y==in.h-1)?2:3;
        for(int tileX=0;tileX<in.w;tileX+=TILE_X) {
          const int tileCount=(tileX+TILE_X<=in.w)?TILE_X:in.w-tileX;
          float acc0[TILE_X]={0},acc1[TILE_X]={0};
          float acc2[TILE_X]={0},acc3[TILE_X]={0};

          for(int ic=0;ic<in.c;ic++) {
            const float *image=in.p+(size_t)ic*hw;
            const int8_t *filter0=weights0+(size_t)ic*9;
            const int8_t *filter1=weights1+(size_t)ic*9;
            const int8_t *filter2=weights2+(size_t)ic*9;
            const int8_t *filter3=weights3+(size_t)ic*9;
            for(int ky=kyBegin;ky<kyEnd;ky++) {
              const int inputY=y+ky-1;
              const float *row=image+inputY*in.w;
              const int tapRow=ky*3;
              for(int kx=0;kx<3;kx++) {
                const int dx=kx-1;
                int xBegin=tileX;
                if(dx<0 && xBegin==0)xBegin=1;
                int xEnd=tileX+tileCount;
                if(dx>0 && xEnd>=in.w)xEnd=in.w-1;
                if(xBegin>=xEnd)continue;

                const float w0=(float)filter0[tapRow+kx];
                const float w1=(float)filter1[tapRow+kx];
                const float w2=(float)filter2[tapRow+kx];
                const float w3=(float)filter3[tapRow+kx];
                const float *pixel=row+xBegin+dx;
                for(int x=xBegin;x<xEnd;x++) {
                  const int t=x-tileX;
                  const float value=*pixel++;
                  acc0[t]+=value*w0; acc1[t]+=value*w1;
                  acc2[t]+=value*w2; acc3[t]+=value*w3;
                }
              }
            }
          }

          const int outputOffset=y*in.w+tileX;
          for(int x=0;x<tileCount;x++) {
            const int index=outputOffset+x;
            float v0=acc0[x]*scale0+bias0;
            float v1=acc1[x]*scale1+bias1;
            float v2=acc2[x]*scale2+bias2;
            float v3=acc3[x]*scale3+bias3;
            out0[index]=v0>0?v0:0;
            out1[index]=v1>0?v1:0;
            out2[index]=v2>0?v2:0;
            out3[index]=v3>0?v3:0;
          }
        }
        if(!(y&15))yield();
      }
    }
    return out;
  }

  // Reference path for any future layer shape not covered by the optimized
  // 3x3/four-channel kernel.
  for(int oc=0;oc<layer.outputChannels;oc++) {
    const int8_t *weights=layer.weights+(size_t)oc*layer.inputChannels*k*k;
    float sc=layer.scales[oc],bias=layer.biases[oc];
    for(int y=0;y<in.h;y++) {
      for(int x=0;x<in.w;x++) {
        float acc=0;
        for(int ic=0;ic<in.c;ic++) {
          const float *img=in.p+(size_t)ic*hw;
          const int8_t *filter=weights+(size_t)ic*k*k;
          for(int ky=0;ky<k;ky++) {
            int iy=y+ky-radius;
            if(iy<0||iy>=in.h)continue;
            for(int kx=0;kx<k;kx++) {
              int ix=x+kx-radius;
              if(ix<0||ix>=in.w)continue;
              acc+=img[iy*in.w+ix]*(float)filter[ky*k+kx];
            }
          }
        }
        float v=acc*sc+bias;
        out.p[(size_t)oc*hw+y*in.w+x]=v>0?v:0;
      }
      if((y&15)==0)yield();
    }
    if((oc&3)==0)yield();
  }
  return out;
}

static Tensor maxPool2(const Tensor &in) {
  if(!in.p||in.h%2||in.w%2)return {};
  Tensor out=createTensor(in.c,in.h/2,in.w/2);
  if(!out.p)return {};
  int a=in.h*in.w,b=out.h*out.w;
  for(int c=0;c<in.c;c++)for(int y=0;y<out.h;y++)for(int x=0;x<out.w;x++) {
    const float *v=in.p+(size_t)c*a+(2*y)*in.w+2*x;
    float best=fmaxf(fmaxf(v[0],v[1]),fmaxf(v[in.w],v[in.w+1]));
    out.p[(size_t)c*b+y*out.w+x]=best;
  }
  return out;
}

static bool block(Tensor &cur,int firstLayer,int pool) {
  for(int j=0;j<2;j++) {
    const int idx = firstLayer + j;
    QuantLayerDef layer = g_layers[idx];
    int8_t *unpacked = nullptr;
    if (!layer.weights) {
      const CompressedBlob &blob = g_layer_blobs[idx];
      unpacked = unpackWeights(blob.data, blob.zLen, blob.rawLen);
      if (!unpacked) return false;
      layer.weights = unpacked;
    }
    Tensor next = convolution(cur, layer);
    if (unpacked) heap_caps_free(unpacked);
    if(!next.p)return false;
    releaseTensor(cur);
    cur=next;
  }
  if(pool) {
    Tensor next=maxPool2(cur);
    if(!next.p)return false;
    releaseTensor(cur);
    cur=next;
  }
  return true;
}

// AdaptiveAvgPool2d((2,2)) on block4 output 256x8x8.
static bool poolToFcInput(const Tensor &t,float pooled[1024]) {
  if(t.c!=256||t.h!=8||t.w!=8||!t.p)return false;
  for(int c=0;c<256;c++)for(int ry=0;ry<2;ry++)for(int rx=0;rx<2;rx++) {
    float sum=0;
    for(int y=ry*4;y<ry*4+4;y++)for(int x=rx*4;x<rx*4+4;x++)
      sum+=t.p[c*64+y*8+x];
    pooled[c*4+ry*2+rx]=sum/16.0f;
  }
  return true;
}

static bool fullyConnected(const float pooled[1024],float z[512]) {
  int8_t *fcW = unpackWeights(g_fc_weights_z, g_fc_weights_z_len, g_fc_weights_raw_len);
  if (!fcW) return false;
  for(int oc=0;oc<512;oc++) {
    const int8_t* weights=fcW+(size_t)oc*1024;
    float acc=0;
    for(int i=0;i<1024;i++)acc+=pooled[i]*(float)weights[i];
    z[oc]=acc*g_fc_scales[oc]+g_fc_biases[oc];
    if((oc&31)==0)yield();
  }
  heap_caps_free(fcW);
  normalize512(z);
  return true;
}

static bool palmbridgeBlend(float z[512]) {
  int8_t *pW = unpackWeights(g_p_weights_z, g_p_weights_z_len, g_p_weights_raw_len);
  if (!pW) return false;
  int chosen=-1;
  float best=INFINITY;
  for(int row=0;row<512;row++) {
    const int8_t* weights=pW+(size_t)row*512;
    float factor=g_p_scales[row],dist=0;
    for(int i=0;i<512;i++) {
      float delta=z[i]-(float)weights[i]*factor;
      dist+=delta*delta;
    }
    if(dist<best){best=dist;chosen=row;}
    if((row&31)==0)yield();
  }
  if(chosen>=0) {
    const int8_t* weights=pW+(size_t)chosen*512;
    const float factor=g_p_scales[chosen];
    for(int i=0;i<512;i++)z[i]=0.7f*z[i]+0.3f*(float)weights[i]*factor;
    normalize512(z);
  }
  heap_caps_free(pW);
  return true;
}
#endif

bool palmPredict(const uint8_t* roi64,PalmPrediction &result) {
  result=PalmPrediction{};
#if !PALM_MODEL_AVAILABLE
  Serial.println("[MODEL] FAILED CLOSED: trained Compact ROI64 weights not exported");
  return false;
#else
  if(!roi64)return false;
  const unsigned long start=millis();
  Tensor cur=createTensor(1,64,64);
  if(!cur.p){Serial.println("[OOM] Cannot allocate normalized input");return false;}
  if(!normalizeInput(roi64,cur.p)){releaseTensor(cur);return false;}
  Tensor g=streamedGabor(cur);
  releaseTensor(cur);
  if(!g.p){Serial.println("[OOM] Gabor");return false;}
  cur=g;
  for(int stage=0;stage<4;stage++) {
    if(!block(cur,stage*2,stage<3)) {
      Serial.printf("[OOM/RUNTIME] convolution stage %d\n",stage+1);
      releaseTensor(cur);
      return false;
    }
    Serial.printf("[MODEL] block%d: %d x %d x %d | free PSRAM=%u\n",
      stage+1,cur.c,cur.h,cur.w,(unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
  }
  float *pooled=allocFloats(1024),*z=allocFloats(512);
  if(!pooled||!z){releaseFloats(pooled);releaseFloats(z);releaseTensor(cur);return false;}
  bool good=poolToFcInput(cur,pooled);
  releaseTensor(cur);
  if(!good){releaseFloats(pooled);releaseFloats(z);return false;}
  if(!fullyConnected(pooled,z)){releaseFloats(pooled);releaseFloats(z);return false;}
  releaseFloats(pooled);
  if(!palmbridgeBlend(z)){releaseFloats(z);return false;}
  int bestIndex=-1;
  for(int k=0;k<4;k++) {
    float s=0;
    for(int i=0;i<512;i++) s+=z[i]*g_centroids[k*512+i];
    result.cosine[k]=s;
    if(bestIndex<0||s>result.cosine[bestIndex]) bestIndex=k;
  }
  releaseFloats(z);
  if(bestIndex<0)return false;
  float second=-2;
  for(int k=0;k<4;k++)if(k!=bestIndex&&result.cosine[k]>second)
    second=result.cosine[k];
  result.person=bestIndex+1;
  result.best=result.cosine[bestIndex];
  result.margin=result.best-second;
  result.latencyMs=millis()-start;
  result.valid=true;
  return true;
#endif
}
