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
 * const dataUrl = processor.toDataURL();
 * ```
 */

export { ImageColorGrading, defaultSettings } from './processor';
export type {
  ColorGradingSettings,
  PartialColorGradingSettings,
  ExportOptions,
} from './types';
