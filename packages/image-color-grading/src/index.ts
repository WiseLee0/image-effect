/**
 * @module image-color-grading
 * 
 * 基于 WebGL 的高性能图像调色库
 * 
 * @example
 * ```ts
 * import { ImageColorGrading, defaultSettings } from 'image-color-grading';
 * 
 * const processor = new ImageColorGrading();
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
} from './types';
