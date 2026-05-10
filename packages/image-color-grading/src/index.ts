/// <reference types="@webgpu/types" />
/**
 * @module image-color-grading
 *
 * 基于 WebGL/WebGPU 的高性能图像调色库
 * 支持双后端自动降级、22+ 种调色参数、.cube LUT 导入
 */

export {
  analyzeImage,
  analyzeImageLevels,
  analyzeImageVibrance,
  defaultSettings,
  ImageColorGrading,
  parseCubeLUT,
  presets,
} from './processor';
export type { CubeLUT } from './processor';
export type {
  BackendType,
  ColorGradingSettings,
  ExportOptions,
  ImageAnalysis,
  ImageLevels,
  LUTParams,
  PartialColorGradingSettings,
  PresetType,
  ProcessorOptions,
} from './types';
