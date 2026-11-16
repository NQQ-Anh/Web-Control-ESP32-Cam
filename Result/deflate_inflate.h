#pragma once
#include <stddef.h>
#include <stdint.h>

// Minimal RFC-1951 raw DEFLATE decompressor (based on Mark Adler's puff.c, zlib license).
// Decompresses `srcLen` raw-deflate bytes into `dst` (capacity `dstCap`), returning true on exact match.
namespace deflate_detail {

struct State {
  uint8_t *out;
  size_t outLen;
  size_t outPos;
  const uint8_t *in;
  size_t inLen;
  size_t inPos;
  uint32_t bitBuf;
  int bitCnt;
};

struct Huffman {
  int16_t *count;
  int16_t *symbol;
};

static constexpr int MAXBITS = 15;
static constexpr int MAXLCODES = 286;
static constexpr int MAXDCODES = 30;
static constexpr int FIXLCODES = 288;

static inline int bits(State &s, int need) {
  uint32_t val = s.bitBuf;
  while (s.bitCnt < need) {
    if (s.inPos >= s.inLen) return -1;
    val |= (uint32_t)s.in[s.inPos++] << s.bitCnt;
    s.bitCnt += 8;
  }
  s.bitBuf = val >> need;
  s.bitCnt -= need;
  return (int)(val & ((1U << need) - 1U));
}

static int stored(State &s) {
  s.bitBuf = 0;
  s.bitCnt = 0;
  if (s.inPos + 4 > s.inLen) return -1;
  uint32_t len = (uint32_t)s.in[s.inPos] | ((uint32_t)s.in[s.inPos + 1] << 8);
  uint32_t nlen = (uint32_t)s.in[s.inPos + 2] | ((uint32_t)s.in[s.inPos + 3] << 8);
  s.inPos += 4;
  if ((len ^ 0xffffU) != nlen) return -2;
  if (s.inPos + len > s.inLen || s.outPos + len > s.outLen) return -3;
  for (uint32_t i = 0; i < len; ++i) s.out[s.outPos++] = s.in[s.inPos++];
  return 0;
}

static int decode(State &s, const Huffman &h) {
  int len = 1;
  int code = 0;
  int first = 0;
  int index = 0;
  int bitBuf = (int)s.bitBuf;
  int left = s.bitCnt;
  int avail = s.bitCnt;
  while (true) {
    while (left--) {
      code |= bitBuf & 1;
      bitBuf >>= 1;
      int count = h.count[len];
      if (code - count < first) {
        s.bitBuf = (uint32_t)bitBuf;
        s.bitCnt = avail - len;
        return h.symbol[index + (code - first)];
      }
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
      ++len;
    }
    left = (MAXBITS + 1) - len;
    if (left == 0) break;
    if (s.inPos >= s.inLen) return -1;
    bitBuf = s.in[s.inPos++];
    avail += 8;
    if (left > 8) left = 8;
  }
  return -10;
}

static int construct(Huffman &h, const int16_t *length, int n) {
  int16_t offs[MAXBITS + 1];
  for (int len = 0; len <= MAXBITS; ++len) h.count[len] = 0;
  for (int sym = 0; sym < n; ++sym) h.count[length[sym]]++;
  if (h.count[0] == n) return 0;

  int left = 1;
  for (int len = 1; len <= MAXBITS; ++len) {
    left <<= 1;
    left -= h.count[len];
    if (left < 0) return left;
  }
  offs[1] = 0;
  for (int len = 1; len < MAXBITS; ++len) offs[len + 1] = offs[len] + h.count[len];
  for (int sym = 0; sym < n; ++sym) {
    if (length[sym] != 0) h.symbol[offs[length[sym]]++] = (int16_t)sym;
  }
  return left;
}

static int codes(State &s, const Huffman &lencode, const Huffman &distcode) {
  static const int16_t lens[29] = {
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258
  };
  static const int16_t lext[29] = {
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
  };
  static const int16_t dists[30] = {
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
  };
  static const int16_t dext[30] = {
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
  };

  int symbol;
  do {
    symbol = decode(s, lencode);
    if (symbol < 0) return symbol;
    if (symbol < 256) {
      if (s.outPos >= s.outLen) return -3;
      s.out[s.outPos++] = (uint8_t)symbol;
    } else if (symbol > 256) {
      symbol -= 257;
      if (symbol >= 29) return -10;
      int extra = bits(s, lext[symbol]);
      if (extra < 0) return -1;
      size_t len = (size_t)lens[symbol] + (size_t)extra;

      symbol = decode(s, distcode);
      if (symbol < 0) return symbol;
      extra = bits(s, dext[symbol]);
      if (extra < 0) return -1;
      size_t dist = (size_t)dists[symbol] + (size_t)extra;
      if (dist > s.outPos || s.outPos + len > s.outLen) return -3;
      while (len--) {
        s.out[s.outPos] = s.out[s.outPos - dist];
        ++s.outPos;
      }
    }
  } while (symbol != 256);
  return 0;
}

static int fixed(State &s) {
  int16_t lencnt[MAXBITS + 1], lensym[FIXLCODES];
  int16_t distcnt[MAXBITS + 1], distsym[MAXDCODES];
  int16_t lengths[FIXLCODES];
  Huffman lencode{lencnt, lensym};
  Huffman distcode{distcnt, distsym};

  int sym = 0;
  for (; sym < 144; ++sym) lengths[sym] = 8;
  for (; sym < 256; ++sym) lengths[sym] = 9;
  for (; sym < 280; ++sym) lengths[sym] = 7;
  for (; sym < FIXLCODES; ++sym) lengths[sym] = 8;
  construct(lencode, lengths, FIXLCODES);

  for (sym = 0; sym < MAXDCODES; ++sym) lengths[sym] = 5;
  construct(distcode, lengths, MAXDCODES);

  return codes(s, lencode, distcode);
}

static int dynamic(State &s) {
  static const int16_t order[19] = {
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15
  };
  int nlen = bits(s, 5);
  int ndist = bits(s, 5);
  int ncode = bits(s, 4);
  if (nlen < 0 || ndist < 0 || ncode < 0) return -1;
  nlen += 257;
  ndist += 1;
  ncode += 4;
  if (nlen > MAXLCODES || ndist > MAXDCODES) return -4;

  int16_t lengths[MAXLCODES + MAXDCODES];
  for (int index = 0; index < ncode; ++index) {
    int b = bits(s, 3);
    if (b < 0) return -1;
    lengths[order[index]] = (int16_t)b;
  }
  for (int index = ncode; index < 19; ++index) lengths[order[index]] = 0;

  int16_t lencnt[MAXBITS + 1], lensym[MAXLCODES];
  int16_t distcnt[MAXBITS + 1], distsym[MAXDCODES];
  Huffman lencode{lencnt, lensym};
  Huffman distcode{distcnt, distsym};

  int err = construct(lencode, lengths, 19);
  if (err != 0) return -5;

  int index = 0;
  while (index < nlen + ndist) {
    int symbol = decode(s, lencode);
    if (symbol < 0) return symbol;
    if (symbol < 16) {
      lengths[index++] = (int16_t)symbol;
    } else {
      int len = 0;
      if (symbol == 16) {
        if (index == 0) return -6;
        len = lengths[index - 1];
        int b = bits(s, 2);
        if (b < 0) return -1;
        symbol = 3 + b;
      } else if (symbol == 17) {
        int b = bits(s, 3);
        if (b < 0) return -1;
        symbol = 3 + b;
      } else {
        int b = bits(s, 7);
        if (b < 0) return -1;
        symbol = 11 + b;
      }
      if (index + symbol > nlen + ndist) return -7;
      while (symbol--) lengths[index++] = (int16_t)len;
    }
  }
  if (lengths[256] == 0) return -9;

  err = construct(lencode, lengths, nlen);
  if (err && (err < 0 || nlen != lencode.count[0] + lencode.count[1])) return -8;
  err = construct(distcode, lengths + nlen, ndist);
  if (err && (err < 0 || ndist != distcode.count[0] + distcode.count[1])) return -8;

  return codes(s, lencode, distcode);
}

} // namespace deflate_detail

static inline bool inflateRaw(const uint8_t *src, size_t srcLen, uint8_t *dst, size_t expectedDstLen) {
  if (!src || !dst || srcLen == 0 || expectedDstLen == 0) return false;
  deflate_detail::State s{dst, expectedDstLen, 0, src, srcLen, 0, 0, 0};
  int last = 0;
  do {
    last = deflate_detail::bits(s, 1);
    int type = deflate_detail::bits(s, 2);
    if (last < 0 || type < 0) return false;
    int err = 0;
    if (type == 0) err = deflate_detail::stored(s);
    else if (type == 1) err = deflate_detail::fixed(s);
    else if (type == 2) err = deflate_detail::dynamic(s);
    else return false;
    if (err != 0) return false;
  } while (!last);
  return s.outPos == expectedDstLen;
}
