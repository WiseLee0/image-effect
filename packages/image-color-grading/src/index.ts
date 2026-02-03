/**
 * @module image-color-grading
 * 
 * 基于 WebGL/WebGPU 的高性能图像调色库
 * 支持双后端自动降级
 * 
 * @example
 * ```ts
 * import { ImageColorGrading, defaultSettings } from 'image-color-grading';
 * 
 * // 自动选择最佳后端（优先 WebGPU）
 * const processor = new ImageColorGrading();
 * 
 * // 指定后端
 * const processor = new ImageColorGrading({ backend: 'webgpu' });
 * const processor = new ImageColorGrading({ backend: 'webgl' });
 * 
 * await processor.loadImage('path/to/image.jpg');
 * processor.setSettings({ 
 *   brightness: 20, 
 *   contrast: 10,
 *   saturation: 15 
 * });
 * 
 * // 自动修复
 * processor.autoFix();
 * 
 * // 或应用预设
 * processor.applyPreset('pop');
 * 
 * const dataUrl = processor.toDataURL();
 * 
 * // 检查当前使用的后端
 * console.log(processor.getBackendType()); // 'webgl' | 'webgpu'
 * ```
 */

export {
  ImageColorGrading,
  defaultSettings,
  presets,
  analyzeImage,
  analyzeImageLevels,
  analyzeImageVibrance,
} from './processor';

export type {
  ColorGradingSettings,
  PartialColorGradingSettings,
  ExportOptions,
  ImageLevels,
  ImageAnalysis,
  PresetType,
  ProcessorOptions,
  BackendType,
} from './types';

// 后端相关导出
export { 
  BaseBackend,
  isWebGPUSupported,
  isWebGLSupported,
  selectBestBackend,
} from './backends/base';

export { WebGLBackend } from './backends/webgl';
export { WebGPUBackend } from './backends/webgpu';
