/**
 * 后端抽象接口
 * 定义 WebGL 和 WebGPU 后端的统一接口
 */

import type { CubeLUT } from '../lut';
import type { ColorGradingSettings, LUTParams } from '../types';

/**
 * 后端类型
 */
export type BackendType = 'webgl' | 'webgpu';

/**
 * 后端初始化选项
 */
export type BackendOptions = Record<string, unknown>;

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
   * 从视频元素加载纹理（建立纹理 + 资源），后续每帧调 updateFromVideo 复用
   *
   * 默认实现 throw，要求子类覆盖
   */
  loadFromVideo(_video: HTMLVideoElement): void {
    throw new Error(`${this.getType()} backend does not implement loadFromVideo`);
  }

  /**
   * 用最新视频帧像素更新源纹理（不重建管线/资源）
   *
   * 默认实现 throw，要求子类覆盖
   */
  updateFromVideo(_video: HTMLVideoElement): void {
    throw new Error(`${this.getType()} backend does not implement updateFromVideo`);
  }

  /**
   * 设置当前 LUT 数据，传 null 清除
   *
   * 默认 noop，子类覆盖
   */
  setLUT(_lut: CubeLUT | null): void {
    /* noop by default */
  }

  /**
   * 设置 LUT 应用参数（强度、肤色保护）
   *
   * 默认 noop，子类覆盖
   */
  setLUTParams(_params: LUTParams): void {
    /* noop by default */
  }

  /**
   * 设置语义肤色 mask（来自 MediaPipe 等分割模型）
   *
   * - 传入灰度图：白(R=255)=皮肤，黑(R=0)=非皮肤，与原图同分辨率最佳（不一致时由 GPU 采样器双线性拉伸）
   * - 传 null 清除：shader 内回落到纯像素 mask
   *
   * 默认 noop，子类覆盖。
   */
  setSkinSegmentationMask(
    _mask:
      | HTMLCanvasElement
      | OffscreenCanvas
      | HTMLImageElement
      | ImageBitmap
      | ImageData
      | null,
  ): void {
    /* noop by default */
  }

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
 *
 * 结果会被缓存：浏览器能力在运行时不会改变，重复检测毫无意义。
 */
let _webgpuSupported: boolean | null = null;
export function isWebGPUSupported(): boolean {
  if (_webgpuSupported === null) {
    _webgpuSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;
  }
  return _webgpuSupported;
}

/**
 * 检测 WebGL 支持
 *
 * 结果会被缓存：每次检测都需要 createElement+getContext('webgl')，
 * 而 WebGL 上下文不会被立即 GC，重复检测会迅速触发
 * "Too many active WebGL contexts" 警告（Chrome 上限约 16）。
 * 所以只检测一次，并主动 loseContext 释放探测用的临时上下文。
 */
let _webglSupported: boolean | null = null;
export function isWebGLSupported(): boolean {
  if (_webglSupported !== null) return _webglSupported;
  if (typeof document === 'undefined') {
    _webglSupported = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    _webglSupported = !!gl;
    // 主动释放探测用的 WebGL 上下文，避免占用一个全局活跃槽位
    if (gl) {
      const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context');
      lose?.loseContext();
    }
  } catch {
    _webglSupported = false;
  }
  return _webglSupported;
}

/**
 * 自动选择最佳后端
 */
export function selectBestBackend(preferred?: 'auto' | BackendType): BackendType {
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
