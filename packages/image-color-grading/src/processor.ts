import {
  type BackendType,
  BaseBackend,
  type ColorGradingSettings,
  type CubeLUT,
  defaultLUTParams,
  defaultSettings,
  type ExportOptions,
  isWebGLSupported,
  isWebGPUSupported,
  type LUTParams,
  MediaPipeSkinSegmenter,
  type PartialColorGradingSettings,
  parseCubeLUT,
  type ProcessorOptions,
  selectBestBackend,
  type SkinSegmentationProvider,
  type SkinSegmenterOptions,
  WebGLBackend,
  WebGPUBackend,
} from 'color-grading-core';
import { analyzeImage, analyzeImageLevels, analyzeImageVibrance } from './analyze';
import type { ImageAnalysis, PresetType } from './types';

export { defaultSettings };
export { analyzeImage, analyzeImageLevels, analyzeImageVibrance };
export { parseCubeLUT };
export type { CubeLUT };

/**
 * 图像处理器扩展选项
 */
export interface ImageProcessorOptions extends ProcessorOptions {
  /**
   * 启用语义肤色分割（MediaPipe SelfieMulticlass）
   * - true：构造时即异步预加载模型；loadImage 后自动对图做分割并喂给后端
   * - false：纯像素 mask（Kovac+YCbCr）模式
   * - 自定义 Provider：用其他分割实现替换
   *
   * 默认 true。模型加载失败会静默回落到纯像素 mask。
   */
  skinSegmentation?: boolean | SkinSegmentationProvider | SkinSegmenterOptions;
}

/**
 * 预设滤镜配置
 */
export const presets: Record<PresetType, PartialColorGradingSettings> = {
  auto: {},
  blackAndWhite: {
    saturation: -100,
    contrast: 20,
    exposure: 10,
    clarity: 10,
  },
  pop: {
    highlights: 50,
    shadows: -50,
    vibrance: 50,
    saturation: 20,
    exposure: 20,
    clarity: 20,
  },
  vintage: {
    saturation: -20,
    contrast: 10,
    temperature: 15,
    grain: 30,
    vignette: 25,
  },
  vivid: {
    vibrance: 40,
    saturation: 20,
    contrast: 15,
    clarity: 20,
  },
  cinematic: {
    contrast: 25,
    highlights: -20,
    shadows: 15,
    temperature: -10,
    vignette: 30,
  },
};

/**
 * 图像调色处理器
 *
 * 支持 WebGL 和 WebGPU 双后端，自动降级
 *
 * @example
 * ```ts
 * const processor = new ImageColorGrading();
 * await processor.loadImage('path/to/image.jpg');
 * processor.setSettings({ brightness: 20, contrast: 10 });
 * const dataUrl = processor.toDataURL();
 * ```
 */
export class ImageColorGrading {
  private canvas: HTMLCanvasElement;
  private backend: BaseBackend | null = null;
  private backendType: BackendType;
  private settings: ColorGradingSettings = { ...defaultSettings };
  private imageLoaded = false;
  private initPromise: Promise<void> | null = null;
  private lutLoaded = false;
  private lutParams: LUTParams = { ...defaultLUTParams };
  private segmenter: SkinSegmentationProvider | null = null;
  /** 标识当前 segmentation 任务，避免旧任务覆盖新图的 mask */
  private segmentationToken = 0;

  constructor(options: ImageProcessorOptions = {}) {
    this.canvas = options.canvas || document.createElement('canvas');
    this.backendType = selectBestBackend(options.backend);

    // 默认启用 MediaPipe；构造时立即开始预加载模型，不阻塞
    const seg = options.skinSegmentation ?? true;
    if (seg !== false) {
      if (typeof seg === 'object' && 'segment' in seg) {
        this.segmenter = seg;
      } else {
        const segOpts = typeof seg === 'object' ? seg : undefined;
        this.segmenter = new MediaPipeSkinSegmenter(segOpts);
      }
      // fire-and-forget；失败由 provider 内部静默处理
      void this.segmenter.init();
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getBackendType(): BackendType {
    return this.backendType;
  }

  static isWebGPUSupported(): boolean {
    return isWebGPUSupported();
  }

  static isWebGLSupported(): boolean {
    return isWebGLSupported();
  }

  getSettings(): ColorGradingSettings {
    return { ...this.settings };
  }

  setSettings(newSettings: PartialColorGradingSettings): void {
    this.settings = { ...this.settings, ...newSettings };
    if (this.backend && this.imageLoaded) {
      this.render();
    }
  }

  resetSettings(): void {
    this.settings = { ...defaultSettings };
    if (this.backend && this.imageLoaded) {
      this.render();
    }
  }

  private async initBackend(): Promise<void> {
    if (this.backend) return;

    const backendOptions = {};

    if (this.backendType === 'webgpu') {
      this.backend = new WebGPUBackend(this.canvas, backendOptions);
      try {
        await this.backend.init();
      } catch (e) {
        console.warn('WebGPU initialization failed, falling back to WebGL:', e);
        this.backend = new WebGLBackend(this.canvas, backendOptions);
        this.backend.init();
        this.backendType = 'webgl';
      }
    } else {
      this.backend = new WebGLBackend(this.canvas, backendOptions);
      this.backend.init();
    }
  }

  private async ensureBackend(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initBackend();
    }
    await this.initPromise;
  }

  async loadImage(url: string): Promise<void> {
    await this.ensureBackend();

    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        this.backend?.loadFromImage(image);
        this.imageLoaded = true;
        this.runSegmentation(image);
        this.render();
        resolve();
      };
      image.onerror = () => {
        reject(new Error(`Failed to load image: ${url}`));
      };
      image.src = url;
    });
  }

  async loadFromImage(image: HTMLImageElement): Promise<void> {
    await this.ensureBackend();
    this.backend?.loadFromImage(image);
    this.imageLoaded = true;
    this.runSegmentation(image);
    this.render();
  }

  async loadFromFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      await this.loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadFromImageData(imageData: ImageData): Promise<void> {
    await this.ensureBackend();
    this.backend?.loadFromImageData(imageData);
    this.imageLoaded = true;
    this.runSegmentation(imageData);
    this.render();
  }

  /**
   * 异步对当前图执行肤色分割，完成后把 mask 喂给后端并触发重渲染
   *
   * - 同时只关心最后一次图源，旧任务的结果会被 token 比较丢弃
   * - 失败/未启用静默忽略，shader 内自动回落到纯像素 mask
   */
  private runSegmentation(
    source:
      | HTMLImageElement
      | HTMLCanvasElement
      | ImageBitmap
      | OffscreenCanvas
      | ImageData,
  ): void {
    if (!this.segmenter) return;
    const token = ++this.segmentationToken;
    void (async () => {
      try {
        const result = await this.segmenter!.segment(source);
        if (token !== this.segmentationToken) {
          // 已经换图：result 是 ImageBitmap 时仍要释放
          if (result?.mask instanceof ImageBitmap) result.mask.close();
          return;
        }
        if (!result || !this.backend) {
          if (result?.mask instanceof ImageBitmap) result.mask.close();
          return;
        }
        this.backend.setSkinSegmentationMask(result.mask);
        // backend 上传同步完成，立即释放 ImageBitmap GPU 内存
        if (result.mask instanceof ImageBitmap) result.mask.close();
        if (this.imageLoaded) this.render();
      } catch {
        // 静默：shader 内 useSegMask=0 时正常回落
      }
    })();
  }

  /**
   * 加载 LUT（接受 .cube 文本、File、URL 字符串或已解析的 CubeLUT 对象）
   */
  async loadLUT(input: string | File | CubeLUT): Promise<void> {
    await this.ensureBackend();
    let lut: CubeLUT;
    if (typeof input === 'string') {
      // 字符串既可能是 .cube 文本，也可能是 URL；若包含换行，按文本处理
      if (input.includes('\n') || input.includes('LUT_3D_SIZE')) {
        lut = parseCubeLUT(input);
      } else {
        const text = await fetch(input).then((r) => r.text());
        lut = parseCubeLUT(text);
      }
    } else if (input instanceof File) {
      const text = await input.text();
      lut = parseCubeLUT(text);
    } else {
      lut = input;
    }
    this.backend?.setLUT(lut);
    this.backend?.setLUTParams(this.lutParams);
    this.lutLoaded = true;
    if (this.imageLoaded) this.render();
  }

  /**
   * 清除已加载的 LUT
   */
  clearLUT(): void {
    if (!this.backend) return;
    this.backend.setLUT(null);
    this.lutLoaded = false;
    if (this.imageLoaded) this.render();
  }

  /**
   * 设置 LUT 应用强度 (0~100)
   */
  setLUTIntensity(intensity: number): void {
    this.lutParams = { ...this.lutParams, intensity: Math.max(0, Math.min(100, intensity)) / 100 };
    this.backend?.setLUTParams(this.lutParams);
    if (this.imageLoaded && this.lutLoaded) this.render();
  }

  /**
   * 设置肤色保护强度 (0~100)
   *
   * @deprecated 推荐使用 setSettings({ skinProtection })，效果一致。
   *   该方法等价于把值写入 ColorGradingSettings.skinProtection；
   *   两个 API 保持双向同步。
   */
  setLUTSkinProtection(skinProtection: number): void {
    const clamped = Math.max(0, Math.min(100, skinProtection));
    this.settings = { ...this.settings, skinProtection: clamped };
    if (this.imageLoaded) this.render();
  }

  /**
   * 是否已加载 LUT
   */
  hasLUT(): boolean {
    return this.lutLoaded;
  }

  render(): void {
    if (!this.backend || !this.imageLoaded) {
      console.warn('No image loaded');
      return;
    }
    this.backend.render(this.settings);
  }

  toDataURL(options?: ExportOptions): string {
    this.render();
    const format = options?.format || 'image/png';
    const quality = options?.quality;
    return this.canvas.toDataURL(format, quality);
  }

  toBlob(options?: ExportOptions): Promise<Blob> {
    this.render();
    return new Promise((resolve, reject) => {
      const format = options?.format || 'image/png';
      const quality = options?.quality;
      this.canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        },
        format,
        quality,
      );
    });
  }

  getImageData(): ImageData {
    if (!this.backend) {
      throw new Error('No backend initialized');
    }
    this.render();
    return this.backend.getImageData();
  }

  getSize(): { width: number; height: number } {
    if (!this.backend) {
      return { width: 0, height: 0 };
    }
    return this.backend.getSize();
  }

  isLoaded(): boolean {
    return this.imageLoaded;
  }

  dispose(): void {
    if (this.backend) {
      this.backend.dispose();
      this.backend = null;
    }
    this.segmenter?.dispose();
    this.segmenter = null;
    this.segmentationToken++;
    this.imageLoaded = false;
    this.initPromise = null;
  }

  analyze(): ImageAnalysis {
    if (!this.imageLoaded || !this.backend) {
      throw new Error('No image loaded');
    }

    const currentSettings = { ...this.settings };
    this.settings = { ...defaultSettings };
    this.render();

    const imageData = this.getImageData();
    const analysis = analyzeImage(imageData);

    this.settings = currentSettings;
    this.render();

    return analysis;
  }

  autoFix(): ColorGradingSettings {
    if (!this.imageLoaded || !this.backend) {
      throw new Error('No image loaded');
    }

    this.settings = { ...defaultSettings };
    this.render();

    const imageData = this.getImageData();
    const levels = analyzeImageLevels(imageData);
    const vibrance = analyzeImageVibrance(imageData);

    const newSettings: ColorGradingSettings = { ...defaultSettings };

    newSettings.whites = Math.round(255 - levels.white);
    newSettings.blacks = Math.round(levels.black);

    if (vibrance < 0.7) {
      const vibranceBoost = Math.round((0.7 - vibrance) * 100);
      newSettings.vibrance = Math.min(vibranceBoost, 50);
    }

    this.settings = newSettings;
    this.render();

    return newSettings;
  }

  applyPreset(preset: PresetType): ColorGradingSettings {
    if (preset === 'auto') {
      return this.autoFix();
    }

    const presetSettings = presets[preset];
    const newSettings: ColorGradingSettings = {
      ...defaultSettings,
      ...presetSettings,
    };

    this.settings = newSettings;
    if (this.backend && this.imageLoaded) {
      this.render();
    }

    return newSettings;
  }
}
