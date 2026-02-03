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
}

/**
 * 部分调色设置参数
 */
export type PartialColorGradingSettings = Partial<ColorGradingSettings>;

/**
 * WebGL 程序信息
 */
export interface ProgramInfo {
  program: WebGLProgram;
  attribs: {
    aPosition: number;
    aTexCoord: number;
    apos: number;
    auv: number;
  };
  uniforms: Record<string, WebGLUniformLocation | null>;
}

/**
 * 渲染目标
 */
export interface RenderTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

/**
 * WebGL 资源
 */
export interface WebGLResources {
  gl: WebGLRenderingContext;
  width: number;
  height: number;
  sourceTexture: WebGLTexture;
  blackPalette: WebGLTexture;
  quad: {
    positionBuffer: WebGLBuffer;
    texCoordBuffer: WebGLBuffer;
  };
  programs: Record<string, ProgramInfo>;
  targets: [RenderTarget, RenderTarget];
}

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
 * 图像色阶分析结果
 */
export interface ImageLevels {
  /** 最暗像素值 (0-255) */
  black: number;
  /** 最亮像素值 (0-255) */
  white: number;
}

/**
 * 图像分析结果
 */
export interface ImageAnalysis {
  /** 色阶信息 */
  levels: ImageLevels;
  /** 鲜艳度 (0-1) */
  vibrance: number;
}

/**
 * 预设滤镜类型
 */
export type PresetType = 'auto' | 'blackAndWhite' | 'pop' | 'vintage' | 'vivid' | 'cinematic';
