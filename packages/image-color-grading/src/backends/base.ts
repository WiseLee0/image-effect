/**
 * 后端抽象接口
 * 定义 WebGL 和 WebGPU 后端的统一接口
 */

import type { ColorGradingSettings } from '../types';

/**
 * 后端类型
 */
export type BackendType = 'webgl' | 'webgpu';

/**
 * 后端初始化选项
 */
export interface BackendOptions {
  // 预留扩展
}

/**
 * 后端抽象基类
 */
export abstract class BaseBackend {
  protected canvas: HTMLCanvasElement;
  protected width: number = 0;
  protected height: number = 0;
  protected initialized: boolean = false;
  protected options: BackendOptions;

  constructor(canvas: HTMLCanvasElement, options: BackendOptions = {}) {
    this.canvas = canvas;
    this.options = options;
  }

  /**
   * 获取后端类型
   */
  abstract getType(): BackendType;

  /**
   * 检查后端是否可用
   */
  static isSupported(): boolean {
    return false;
  }

  /**
   * 初始化后端
   */
  abstract init(): Promise<void> | void;

  /**
   * 从图像元素加载纹理
   */
  abstract loadFromImage(image: HTMLImageElement): void;

  /**
   * 从 ImageData 加载纹理
   */
  abstract loadFromImageData(imageData: ImageData): void;

  /**
   * 渲染图像
   */
  abstract render(settings: ColorGradingSettings): void;

  /**
   * 获取渲染结果的 ImageData
   */
  abstract getImageData(): ImageData;

  /**
   * 获取图像尺寸
   */
  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 销毁后端资源
   */
  abstract dispose(): void;
}

/**
 * 检测 WebGPU 支持
 */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * 检测 WebGL 支持
 */
export function isWebGLSupported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}

/**
 * 自动选择最佳后端
 */
export function selectBestBackend(
  preferred?: 'auto' | BackendType
): BackendType {
  if (preferred === 'webgpu' && isWebGPUSupported()) {
    return 'webgpu';
  }
  if (preferred === 'webgl' && isWebGLSupported()) {
    return 'webgl';
  }
  // auto 模式：优先 WebGPU
  if (preferred === 'auto' || preferred === undefined) {
    if (isWebGPUSupported()) return 'webgpu';
    if (isWebGLSupported()) return 'webgl';
  }
  throw new Error('No supported graphics backend available');
}
