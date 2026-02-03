/**
 * 通用工具函数
 */

/**
 * 限制值在 0-1 范围内
 */
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 三次贝塞尔曲线
 */
export const cubicBezier = (t: number, p0: number, p1: number, p2: number, p3: number): number => {
  const u = 1 - t;
  return (
    u * u * u * p0 +
    3 * u * u * t * p1 +
    3 * u * t * t * p2 +
    t * t * t * p3
  );
};

const PALETTE_SIZE = 256;

/**
 * 构建曲线调色板
 */
export const buildCurvePalette = (lowControl: number, highControl: number): Uint8Array => {
  const data = new Uint8Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i += 1) {
    const t = i / (PALETTE_SIZE - 1);
    const y = cubicBezier(t, 0, lowControl, highControl, 1);
    const v = Math.round(clamp01(y) * 255);
    const idx = i * 3;
    data[idx] = v;
    data[idx + 1] = v;
    data[idx + 2] = v;
  }
  return data;
};

/**
 * 构建黑色调色板
 */
export const buildBlackPalette = (amount: number): Uint8Array => {
  const amt = Math.max(-100, Math.min(100, amount)) / 100;
  const strength = 0.35;
  const lowControl = clamp01(0.33 - amt * strength);
  const highControl = 0.66;
  return buildCurvePalette(lowControl, highControl);
};

/**
 * 构建对比度矩阵
 */
export const buildContrastMatrix = (amount: number): Float32Array => {
  const t = Math.max(-100, Math.min(100, amount)) / 100;
  const scale = 1 + t;
  const offset = 0.5 * (1 - scale);
  return new Float32Array([
    scale, 0, 0, 0, offset,
    0, scale, 0, 0, offset,
    0, 0, scale, 0, offset,
    0, 0, 0, 1, 0,
  ]);
};

/**
 * 构建饱和度矩阵
 */
export const buildSaturationMatrix = (amount: number): Float32Array => {
  const t = Math.max(-100, Math.min(100, amount)) / 100;
  const scale = 1 + t;
  const lumR = 0.299;
  const lumG = 0.587;
  const lumB = 0.114;
  const inv = 1 - scale;
  return new Float32Array([
    inv * lumR + scale, inv * lumG, inv * lumB, 0, 0,
    inv * lumR, inv * lumG + scale, inv * lumB, 0, 0,
    inv * lumR, inv * lumG, inv * lumB + scale, 0, 0,
    0, 0, 0, 1, 0,
  ]);
};
