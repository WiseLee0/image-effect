/// <reference types="@webgpu/types" />
/**
 * @module video-color-grading
 *
 * 基于 WebGL/WebGPU 的视频实时调色库
 * 复用 color-grading-core 引擎，支持 22+ 调色参数 + .cube LUT + MP4/WebM 导出（mediabunny）
 */

export {
  defaultSettings,
  parseCubeLUT,
  VideoColorGrading,
} from './processor';
export type {
  BackendType,
  ColorGradingSettings,
  CubeLUT,
  LUTParams,
  PartialColorGradingSettings,
  ProcessorOptions,
} from './processor';
export { exportVideo } from './recorder';
export type { ExportVideoOptions } from './recorder';
