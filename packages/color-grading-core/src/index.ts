/// <reference types="@webgpu/types" />
/**
 * @module color-grading-core
 *
 * 通用调色引擎核心
 *
 * 提供 WebGL/WebGPU 双后端的调色管线、LUT 支持、调色参数定义。
 * 被 image-color-grading / video-color-grading 等上层包共享。
 */

export {
  BaseBackend,
  isWebGLSupported,
  isWebGPUSupported,
  selectBestBackend,
} from './backends/base';
export { WebGLBackend } from './backends/webgl';
export { WebGPUBackend } from './backends/webgpu';
export type { BackendOptions } from './backends/base';

export {
  buildBlackPalette,
  buildContrastMatrix,
  buildCurvePalette,
  buildSaturationMatrix,
  clamp01,
  cubicBezier,
} from './utils/common';

export { type CubeLUT, lutToFlat2D, lutToRGBA8, parseCubeLUT } from './lut';

export type {
  BackendType,
  ColorGradingSettings,
  ExportOptions,
  LUTParams,
  PartialColorGradingSettings,
  ProcessorOptions,
} from './types';

export { defaultLUTParams, defaultSettings } from './types';

export {
  MediaPipeSkinSegmenter,
} from './segmentation';
export type {
  SkinSegmentationProvider,
  SkinSegmentationResult,
  SkinSegmentationSource,
  SkinSegmenterOptions,
} from './segmentation';
