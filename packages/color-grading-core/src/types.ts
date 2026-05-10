/**
 * 通用调色后端无关类型
 */

/**
 * 后端类型
 */
export type BackendType = 'webgl' | 'webgpu';

/**
 * 处理器配置选项
 */
export interface ProcessorOptions {
  /** canvas 元素 */
  canvas?: HTMLCanvasElement;
  /** 后端选择：'auto' | 'webgpu' | 'webgl' */
  backend?: 'auto' | BackendType;
}

/**
 * 调色设置参数
 */
export interface ColorGradingSettings {
  /** 自然饱和度 (-100 ~ 100) */
  vibrance: number;
  /** 饱和度 (-100 ~ 100) */
  saturation: number;
  /** 色温 (-100 ~ 100) */
  temperature: number;
  /** 色调 (-100 ~ 100) */
  tint: number;
  /** 色相 (-100 ~ 100) */
  hue: number;
  /** 亮度 (-100 ~ 100) */
  brightness: number;
  /** 曝光度 (-100 ~ 100) */
  exposure: number;
  /** 对比度 (-100 ~ 100) */
  contrast: number;
  /** 黑色 (-100 ~ 100) */
  blacks: number;
  /** 白色 (-100 ~ 100) */
  whites: number;
  /** 高光 (-100 ~ 100) */
  highlights: number;
  /** 暗调 (-100 ~ 100) */
  shadows: number;
  /** 除雾化 (0 ~ 100) */
  dehaze: number;
  /** 泛光 (0 ~ 100) */
  bloom: number;
  /** 氛围美化 (0 ~ 100) */
  glamour: number;
  /** 清晰度 (-100 ~ 100) */
  clarity: number;
  /** 锐化 (0 ~ 100) */
  sharpen: number;
  /** 平滑 (0 ~ 100) */
  smooth: number;
  /** 模糊 (0 ~ 100) */
  blur: number;
  /** 暗角 (-100 ~ 100) */
  vignette: number;
  /** 颗粒 (0 ~ 100) */
  grain: number;
  /** 肤色保护 (0 ~ 100)，仅在 LUT 应用时生效 */
  skinProtection: number;
}

/**
 * 部分调色设置参数
 */
export type PartialColorGradingSettings = Partial<ColorGradingSettings>;

/**
 * 默认设置（所有参数为 0）
 */
export const defaultSettings: ColorGradingSettings = {
  vibrance: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  brightness: 0,
  exposure: 0,
  contrast: 0,
  blacks: 0,
  whites: 0,
  highlights: 0,
  shadows: 0,
  dehaze: 0,
  bloom: 0,
  glamour: 0,
  clarity: 0,
  sharpen: 0,
  smooth: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  skinProtection: 0,
};

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 导出格式 */
  format?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** JPEG/WebP 质量 (0-1) */
  quality?: number;
}

/**
 * LUT 应用参数
 */
export interface LUTParams {
  /** 应用强度 (0 ~ 1)，0 = 不应用，1 = 完全应用 */
  intensity: number;
  /** 肤色保护强度 (0 ~ 1)，0 = 不保护，1 = 肤色区域完全不受 LUT 影响 */
  skinProtection: number;
}

/**
 * 默认 LUT 参数
 */
export const defaultLUTParams: LUTParams = {
  intensity: 1,
  skinProtection: 0,
};
