/**
 * @hilo/image-color-grading 专用类型
 *
 * 通用调色类型从 color-grading-core 重新导出。
 */

export type {
  BackendType,
  ColorGradingSettings,
  ExportOptions,
  LUTParams,
  PartialColorGradingSettings,
  ProcessorOptions,
} from 'color-grading-core';

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
