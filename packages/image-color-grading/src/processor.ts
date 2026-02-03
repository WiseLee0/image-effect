import type {
  ColorGradingSettings,
  PartialColorGradingSettings,
  ExportOptions,
  ImageLevels,
  ImageAnalysis,
  PresetType,
  ProcessorOptions,
  BackendType,
} from './types';
import { BaseBackend, selectBestBackend, isWebGPUSupported, isWebGLSupported } from './backends/base';
import { WebGLBackend } from './backends/webgl';
import { WebGPUBackend } from './backends/webgpu';

/**
 * 默认设置
 */
export const defaultSettings: ColorGradingSettings = {
  vibrance: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  brightness: 0,
  exposure: 0,
  contrast: 0,
  blacks: 0,
  whites: 0,
  highlights: 0,
  shadows: 0,
  dehaze: 0,
  bloom: 0,
  glamour: 0,
  clarity: 0,
  sharpen: 0,
  smooth: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
};

/**
 * 预设滤镜配置
 */
export const presets: Record<PresetType, PartialColorGradingSettings> = {
  auto: {}, // 自动模式需要分析图像，这里只是占位
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
 * 分析图像获取黑白色阶信息
 * 使用直方图分析，忽略极端少数的像素值
 * @param imageData - ImageData 对象
 * @returns {black, white} 分别表示有效的最暗和最亮的亮度值 (0-255)
 */
export function analyzeImageLevels(imageData: ImageData): ImageLevels {
  const { data, width, height } = imageData;

  // 创建直方图数组 (0-255)
  const histogram = new Array(256).fill(0);

  // 统计每个颜色值的出现次数
  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]] += 1;     // R
    histogram[data[i + 1]] += 1; // G
    histogram[data[i + 2]] += 1; // B
  }

  // 阈值：忽略少于 0.1% 的像素
  const threshold = Math.round((width * height) / 1e3);

  // 从暗到亮找到第一个超过阈值的值作为黑色点
  let black = 0;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > threshold) {
      black = i;
      break;
    }
  }

  // 从亮到暗找到第一个超过阈值的值作为白色点
  let white = 255;
  for (let i = 255; i >= 0; i--) {
    if (histogram[i] > threshold) {
      white = i;
      break;
    }
  }

  // 限制范围，避免过度调整
  if (black > 100) black = 100;
  if (white < 155) white = 155;

  return { black, white };
}

/**
 * 分析图像的饱和度/鲜艳度
 * 使用 HSV 色彩空间计算，返回 0-1 之间的值
 * @param imageData - ImageData 对象
 * @returns 鲜艳度值 (0-1)
 */
export function analyzeImageVibrance(imageData: ImageData): number {
  const { data, width, height } = imageData;
  let saturationSum = 1;  // 初始值为1，避免除零
  let brightnessSum = 1;

  // 遍历所有像素
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);

    // 累加亮度 (HSV 中的 Value)
    brightnessSum += max / 255;

    // 计算色度 (chroma)
    const chroma = max - min;
    if (chroma > 0) {
      // HSV 饱和度 = chroma / max
      saturationSum += chroma / max;
    }
  }

  // 返回饱和度和亮度的平均值
  const pixelCount = width * height;
  return (saturationSum + brightnessSum) / (pixelCount * 2);
}

/**
 * 分析图像
 * @param imageData - ImageData 对象
 * @returns 图像分析结果
 */
export function analyzeImage(imageData: ImageData): ImageAnalysis {
  return {
    levels: analyzeImageLevels(imageData),
    vibrance: analyzeImageVibrance(imageData),
  };
}

/**
 * 图像调色处理器
 * 
 * 支持 WebGL 和 WebGPU 双后端，自动降级
 *
 * @example
 * ```ts
 * // 默认自动选择后端
 * const processor = new ImageColorGrading();
 * 
 * // 指定使用 WebGPU
 * const processor = new ImageColorGrading({ backend: 'webgpu' });
 * 
 * await processor.loadImage('path/to/image.jpg');
 * processor.setSettings({ brightness: 20, contrast: 10 });
 * processor.render();
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

  /**
   * 创建图像调色处理器
   * @param options - 配置选项
   */
  constructor(options: ProcessorOptions = {}) {
    this.canvas = options.canvas || document.createElement('canvas');
    this.backendType = selectBestBackend(options.backend);
  }

  /**
   * 获取 canvas 元素
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * 获取当前后端类型
   */
  getBackendType(): BackendType {
    return this.backendType;
  }

  /**
   * 检查 WebGPU 是否可用
   */
  static isWebGPUSupported(): boolean {
    return isWebGPUSupported();
  }

  /**
   * 检查 WebGL 是否可用
   */
  static isWebGLSupported(): boolean {
    return isWebGLSupported();
  }

  /**
   * 获取当前设置
   */
  getSettings(): ColorGradingSettings {
    return { ...this.settings };
  }

  /**
   * 设置调色参数
   * @param newSettings - 部分或全部设置参数
   */
  setSettings(newSettings: PartialColorGradingSettings): void {
    this.settings = { ...this.settings, ...newSettings };
    if (this.backend && this.imageLoaded) {
      this.render();
    }
  }

  /**
   * 重置所有设置为默认值
   */
  resetSettings(): void {
    this.settings = { ...defaultSettings };
    if (this.backend && this.imageLoaded) {
      this.render();
    }
  }

  /**
   * 初始化后端
   */
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

  /**
   * 确保后端已初始化
   */
  private async ensureBackend(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initBackend();
    }
    await this.initPromise;
  }

  /**
   * 从 URL 加载图像
   * @param url - 图像 URL
   * @returns Promise
   */
  async loadImage(url: string): Promise<void> {
    await this.ensureBackend();
    
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        this.backend!.loadFromImage(image);
        this.imageLoaded = true;
        this.render();
        resolve();
      };
      image.onerror = () => {
        reject(new Error(`Failed to load image: ${url}`));
      };
      image.src = url;
    });
  }

  /**
   * 从 HTMLImageElement 加载图像
   * @param image - 图像元素
   */
  async loadFromImage(image: HTMLImageElement): Promise<void> {
    await this.ensureBackend();
    this.backend!.loadFromImage(image);
    this.imageLoaded = true;
    this.render();
  }

  /**
   * 从 File 对象加载图像
   * @param file - File 对象
   * @returns Promise
   */
  async loadFromFile(file: File): Promise<void> {
    const url = URL.createObjectURL(file);
    try {
      await this.loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * 从 ImageData 加载图像
   * @param imageData - ImageData 对象
   */
  async loadFromImageData(imageData: ImageData): Promise<void> {
    await this.ensureBackend();
    this.backend!.loadFromImageData(imageData);
    this.imageLoaded = true;
    this.render();
  }

  /**
   * 渲染图像
   */
  render(): void {
    if (!this.backend || !this.imageLoaded) {
      console.warn('No image loaded');
      return;
    }
    this.backend.render(this.settings);
  }

  /**
   * 导出为 Data URL
   * @param options - 导出选项
   * @returns Data URL 字符串
   */
  toDataURL(options?: ExportOptions): string {
    // WebGPU canvas 内容在帧结束后会被清除，需要重新渲染
    this.render();
    const format = options?.format || 'image/png';
    const quality = options?.quality;
    return this.canvas.toDataURL(format, quality);
  }

  /**
   * 导出为 Blob
   * @param options - 导出选项
   * @returns Promise<Blob>
   */
  toBlob(options?: ExportOptions): Promise<Blob> {
    // WebGPU canvas 内容在帧结束后会被清除，需要重新渲染
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
        quality
      );
    });
  }

  /**
   * 获取 ImageData
   * @returns ImageData
   */
  getImageData(): ImageData {
    if (!this.backend) {
      throw new Error('No backend initialized');
    }
    // WebGPU canvas 内容在帧结束后会被清除，需要重新渲染
    this.render();
    return this.backend.getImageData();
  }

  /**
   * 获取图像尺寸
   */
  getSize(): { width: number; height: number } {
    if (!this.backend) {
      return { width: 0, height: 0 };
    }
    return this.backend.getSize();
  }

  /**
   * 检查是否已加载图像
   */
  isLoaded(): boolean {
    return this.imageLoaded;
  }

  /**
   * 销毁资源
   */
  dispose(): void {
    if (this.backend) {
      this.backend.dispose();
      this.backend = null;
    }
    this.imageLoaded = false;
    this.initPromise = null;
  }

  /**
   * 分析当前加载的图像
   * @returns 图像分析结果
   */
  analyze(): ImageAnalysis {
    if (!this.imageLoaded || !this.backend) {
      throw new Error('No image loaded');
    }

    // 先重置设置以获取原始图像数据
    const currentSettings = { ...this.settings };
    this.settings = { ...defaultSettings };
    this.render();

    const imageData = this.getImageData();
    const analysis = analyzeImage(imageData);

    // 恢复设置
    this.settings = currentSettings;
    this.render();

    return analysis;
  }

  /**
   * 自动修复图像
   * 分析图像并自动调整色阶和鲜艳度
   * @returns 应用的设置
   */
  autoFix(): ColorGradingSettings {
    if (!this.imageLoaded || !this.backend) {
      throw new Error('No image loaded');
    }

    // 先重置设置以获取原始图像数据
    this.settings = { ...defaultSettings };
    this.render();

    const imageData = this.getImageData();
    const levels = analyzeImageLevels(imageData);
    const vibrance = analyzeImageVibrance(imageData);

    const newSettings: ColorGradingSettings = { ...defaultSettings };

    // 根据分析结果调整黑白色阶
    newSettings.whites = Math.round(255 - levels.white);
    newSettings.blacks = Math.round(levels.black);

    // 如果图像不够鲜艳，增加自然饱和度
    if (vibrance < 0.7) {
      const vibranceBoost = Math.round((0.7 - vibrance) * 100);
      newSettings.vibrance = Math.min(vibranceBoost, 50);
    }

    this.settings = newSettings;
    this.render();

    return newSettings;
  }

  /**
   * 应用预设滤镜
   * @param preset - 预设类型
   * @returns 应用的设置
   */
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
