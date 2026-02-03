import type {
  ColorGradingSettings,
  PartialColorGradingSettings,
  ProgramInfo,
  RenderTarget,
  WebGLResources,
  ExportOptions,
  ImageLevels,
  ImageAnalysis,
  PresetType,
} from './types';
import * as shaders from './shaders';
import {
  buildProgram,
  createRenderTarget,
  createPaletteTexture,
  updatePaletteTexture,
  buildBlackPalette,
  buildContrastMatrix,
  buildSaturationMatrix,
} from './utils';

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
 * @example
 * ```ts
 * const processor = new ImageColorGrading();
 * await processor.loadImage('path/to/image.jpg');
 * processor.setSettings({ brightness: 20, contrast: 10 });
 * processor.render();
 * const dataUrl = processor.toDataURL();
 * ```
 */
export class ImageColorGrading {
  private canvas: HTMLCanvasElement;
  private resources: WebGLResources | null = null;
  private settings: ColorGradingSettings = { ...defaultSettings };
  private imageLoaded = false;

  /**
   * 创建图像调色处理器
   * @param canvas - 可选的 canvas 元素，不传则自动创建
   */
  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas || document.createElement('canvas');
  }

  /**
   * 获取 canvas 元素
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
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
    if (this.resources) {
      this.render();
    }
  }

  /**
   * 重置所有设置为默认值
   */
  resetSettings(): void {
    this.settings = { ...defaultSettings };
    if (this.resources) {
      this.render();
    }
  }

  /**
   * 从 URL 加载图像
   * @param url - 图像 URL
   * @returns Promise
   */
  loadImage(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        this.initFromImage(image);
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
  loadFromImage(image: HTMLImageElement): void {
    this.initFromImage(image);
  }

  /**
   * 从 File 对象加载图像
   * @param file - File 对象
   * @returns Promise
   */
  loadFromFile(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      this.loadImage(url)
        .then(() => {
          URL.revokeObjectURL(url);
          resolve();
        })
        .catch((err) => {
          URL.revokeObjectURL(url);
          reject(err);
        });
    });
  }

  /**
   * 从 ImageData 加载图像
   * @param imageData - ImageData 对象
   */
  loadFromImageData(imageData: ImageData): void {
    const { width, height, data } = imageData;
    this.canvas.width = width;
    this.canvas.height = height;

    const gl = this.getWebGLContext();
    if (!gl) throw new Error('WebGL not supported');

    this.disposeResources();

    gl.viewport(0, 0, width, height);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const sourceTexture = gl.createTexture();
    if (!sourceTexture) throw new Error('Failed to create texture');

    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.initResources(gl, width, height, sourceTexture);
  }

  /**
   * 渲染图像
   */
  render(): void {
    if (!this.resources) {
      console.warn('No image loaded');
      return;
    }
    this.drawFrame(this.resources, this.settings);
  }

  /**
   * 导出为 Data URL
   * @param options - 导出选项
   * @returns Data URL 字符串
   */
  toDataURL(options?: ExportOptions): string {
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
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      return ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    // 如果是 WebGL 上下文，需要通过 readPixels 读取
    const gl = this.canvas.getContext('webgl');
    if (gl) {
      const pixels = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);
      gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return new ImageData(pixels, this.canvas.width, this.canvas.height);
    }

    throw new Error('Cannot get ImageData');
  }

  /**
   * 获取图像尺寸
   */
  getSize(): { width: number; height: number } {
    return {
      width: this.canvas.width,
      height: this.canvas.height,
    };
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
    this.disposeResources();
    this.imageLoaded = false;
  }

  /**
   * 分析当前加载的图像
   * @returns 图像分析结果
   */
  analyze(): ImageAnalysis {
    if (!this.imageLoaded) {
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
    if (!this.imageLoaded) {
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
    if (this.resources) {
      this.render();
    }

    return newSettings;
  }

  // ===== 私有方法 =====

  private getWebGLContext(): WebGLRenderingContext | null {
    return this.canvas.getContext('webgl', {
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
  }

  private initFromImage(image: HTMLImageElement): void {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    this.canvas.width = width;
    this.canvas.height = height;

    const gl = this.getWebGLContext();
    if (!gl) throw new Error('WebGL not supported');

    this.disposeResources();

    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, width, height);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const sourceTexture = gl.createTexture();
    if (!sourceTexture) throw new Error('Failed to create texture');

    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.initResources(gl, width, height, sourceTexture);
  }

  private initResources(
    gl: WebGLRenderingContext,
    width: number,
    height: number,
    sourceTexture: WebGLTexture
  ): void {
    const blackPalette = createPaletteTexture(gl, buildBlackPalette(0));

    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    if (!positionBuffer || !texCoordBuffer) {
      throw new Error('Failed to create buffers');
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const programs = {
      pass: buildProgram(gl, shaders.vertexSource, shaders.passFragment, ['uTexture']),
      vibrance: buildProgram(gl, shaders.vertexSource, shaders.vibranceFragment, ['uTexture', 'uAmount']),
      saturation: buildProgram(gl, shaders.vertexSource, shaders.saturationFragment, ['uTexture', 'uMatrix[0]']),
      temperature: buildProgram(gl, shaders.vertexSource, shaders.temperatureFragment, ['uTexture', 'uAmount']),
      tint: buildProgram(gl, shaders.vertexSource, shaders.tintFragment, ['uTexture', 'uAmount']),
      hue: buildProgram(gl, shaders.vertexSource, shaders.hueFragment, ['uTexture', 'uRotation']),
      brightness: buildProgram(gl, shaders.vertexSource, shaders.brightnessFragment, ['uTexture', 'uAmount']),
      exposure: buildProgram(gl, shaders.vertexSource, shaders.exposureFragment, ['uTexture', 'uAmount']),
      contrast: buildProgram(gl, shaders.vertexSource, shaders.contrastFragment, ['uTexture', 'uMatrix[0]']),
      blacks: buildProgram(gl, shaders.blackVertexSource, shaders.blackPaletteFragment, [
        'uTexture',
        'uPaletteMap',
        'transform',
      ]),
      whites: buildProgram(gl, shaders.vertexSource, shaders.whitesFragment, ['uTexture', 'uAmount']),
      highlights: buildProgram(gl, shaders.vertexSource, shaders.highlightsFragment, ['uTexture', 'uAmount']),
      shadows: buildProgram(gl, shaders.vertexSource, shaders.shadowsFragment, ['uTexture', 'uAmount']),
      dehaze: buildProgram(gl, shaders.vertexSource, shaders.dehazeFragment, ['uTexture', 'uAmount', 'uSize']),
      bloom: buildProgram(gl, shaders.vertexSource, shaders.bloomFragment, ['uTexture', 'uAmount', 'uTexel', 'uThreshold']),
      glamour: buildProgram(gl, shaders.vertexSource, shaders.glamourFragment, ['uTexture', 'uAmount', 'uTexel']),
      clarity: buildProgram(gl, shaders.vertexSource, shaders.clarityFragment, ['uTexture', 'uAmount', 'uTexel']),
      sharpen: buildProgram(gl, shaders.vertexSource, shaders.kernelFragment, ['uTexture', 'uTexel', 'uKernel[0]', 'uAmount']),
      smooth: buildProgram(gl, shaders.vertexSource, shaders.kernelFragment, ['uTexture', 'uTexel', 'uKernel[0]', 'uAmount']),
      blur: buildProgram(gl, shaders.vertexSource, shaders.blurFragment, ['uTexture', 'uSize']),
      vignette: buildProgram(gl, shaders.vertexSource, shaders.vignetteFragment, ['uTexture', 'uAmount', 'uSize']),
      grain: buildProgram(gl, shaders.vertexSource, shaders.grainFragment, ['uTexture', 'uResolution', 'uAmount', 'uTime']),
    };

    const targets: [RenderTarget, RenderTarget] = [
      createRenderTarget(gl, width, height),
      createRenderTarget(gl, width, height),
    ];

    this.resources = {
      gl,
      width,
      height,
      sourceTexture,
      blackPalette,
      quad: { positionBuffer, texCoordBuffer },
      programs,
      targets,
    };

    this.imageLoaded = true;
    this.render();
  }

  private disposeResources(): void {
    if (!this.resources) return;

    const { gl, sourceTexture, blackPalette, quad, programs, targets } = this.resources;
    gl.deleteTexture(sourceTexture);
    gl.deleteTexture(blackPalette);
    gl.deleteBuffer(quad.positionBuffer);
    gl.deleteBuffer(quad.texCoordBuffer);
    targets.forEach((target) => {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    });
    Object.values(programs).forEach((programInfo) => {
      gl.deleteProgram(programInfo.program);
    });

    this.resources = null;
  }

  private drawFrame(resources: WebGLResources, settings: ColorGradingSettings): void {
    const {
      gl,
      width,
      height,
      sourceTexture,
      blackPalette,
      quad,
      programs,
      targets,
    } = resources;

    gl.viewport(0, 0, width, height);

    const texel = [1 / width, 1 / height] as const;
    let inputTexture = sourceTexture;
    let pingIndex = 0;

    const bindAttributes = (program: ProgramInfo) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad.positionBuffer);
      const positionAttrib =
        program.attribs.aPosition >= 0
          ? program.attribs.aPosition
          : program.attribs.apos;
      if (positionAttrib >= 0) {
        gl.enableVertexAttribArray(positionAttrib);
        gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 0, 0);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, quad.texCoordBuffer);
      const texAttrib =
        program.attribs.aTexCoord >= 0
          ? program.attribs.aTexCoord
          : program.attribs.auv;
      if (texAttrib >= 0) {
        gl.enableVertexAttribArray(texAttrib);
        gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 0, 0);
      }
    };

    const drawPass = (
      program: ProgramInfo,
      setupUniforms: () => void,
      output: RenderTarget | null
    ) => {
      gl.useProgram(program.program);
      bindAttributes(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      const textureLoc = program.uniforms.uTexture;
      if (textureLoc) gl.uniform1i(textureLoc, 0);
      setupUniforms();
      gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.framebuffer : null);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      inputTexture = output ? output.texture : inputTexture;
    };

    const swapTarget = () => {
      const target = targets[pingIndex % 2];
      pingIndex += 1;
      return target;
    };

    // Vibrance
    if (Math.abs(settings.vibrance) > 0.5) {
      drawPass(
        programs.vibrance,
        () => {
          gl.uniform1f(programs.vibrance.uniforms.uAmount, settings.vibrance / 100);
        },
        swapTarget()
      );
    }

    // Saturation
    if (Math.abs(settings.saturation) > 0.5) {
      drawPass(
        programs.saturation,
        () => {
          const matrix = buildSaturationMatrix(settings.saturation);
          gl.uniform1fv(programs.saturation.uniforms['uMatrix[0]'], matrix);
        },
        swapTarget()
      );
    }

    // Temperature
    if (Math.abs(settings.temperature) > 0.5) {
      drawPass(
        programs.temperature,
        () => {
          gl.uniform1f(programs.temperature.uniforms.uAmount, settings.temperature / 500);
        },
        swapTarget()
      );
    }

    // Tint
    if (Math.abs(settings.tint) > 0.5) {
      drawPass(
        programs.tint,
        () => {
          gl.uniform1f(programs.tint.uniforms.uAmount, settings.tint / 500);
        },
        swapTarget()
      );
    }

    // Hue
    if (Math.abs(settings.hue) > 0.5) {
      drawPass(
        programs.hue,
        () => {
          gl.uniform1f(programs.hue.uniforms.uRotation, settings.hue / 200);
        },
        swapTarget()
      );
    }

    // Brightness
    drawPass(
      programs.brightness,
      () => {
        gl.uniform1f(programs.brightness.uniforms.uAmount, settings.brightness / 200);
      },
      swapTarget()
    );

    // Exposure
    if (Math.abs(settings.exposure) > 0.5) {
      drawPass(
        programs.exposure,
        () => {
          gl.uniform1f(programs.exposure.uniforms.uAmount, settings.exposure / 100);
        },
        swapTarget()
      );
    }

    // Contrast
    if (Math.abs(settings.contrast) > 0.5) {
      drawPass(
        programs.contrast,
        () => {
          const matrix = buildContrastMatrix(settings.contrast);
          gl.uniform1fv(programs.contrast.uniforms['uMatrix[0]'], matrix);
        },
        swapTarget()
      );
    }

    // Blacks
    if (Math.abs(settings.blacks) > 0.5) {
      updatePaletteTexture(gl, blackPalette, buildBlackPalette(settings.blacks));
      drawPass(
        programs.blacks,
        () => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, blackPalette);
          gl.uniform1i(programs.blacks.uniforms.uPaletteMap, 1);
          gl.uniform4f(programs.blacks.uniforms.transform, 1.0, 1.0, 0.0, 0.0);
          gl.activeTexture(gl.TEXTURE0);
        },
        swapTarget()
      );
    }

    // Whites
    if (Math.abs(settings.whites) > 0.5) {
      drawPass(
        programs.whites,
        () => {
          gl.uniform1f(programs.whites.uniforms.uAmount, settings.whites / 400);
        },
        swapTarget()
      );
    }

    // Highlights
    if (Math.abs(settings.highlights) > 0.5) {
      drawPass(
        programs.highlights,
        () => {
          gl.uniform1f(programs.highlights.uniforms.uAmount, settings.highlights / 100);
        },
        swapTarget()
      );
    }

    // Shadows
    if (Math.abs(settings.shadows) > 0.5) {
      drawPass(
        programs.shadows,
        () => {
          gl.uniform1f(programs.shadows.uniforms.uAmount, settings.shadows / 100);
        },
        swapTarget()
      );
    }

    // Dehaze
    if (Math.abs(settings.dehaze) > 0.5) {
      drawPass(
        programs.dehaze,
        () => {
          gl.uniform1f(programs.dehaze.uniforms.uAmount, settings.dehaze / 100);
          gl.uniform2f(programs.dehaze.uniforms.uSize, width, height);
        },
        swapTarget()
      );
    }

    // Bloom
    if (settings.bloom > 0.5) {
      drawPass(
        programs.bloom,
        () => {
          gl.uniform1f(programs.bloom.uniforms.uAmount, settings.bloom / 100);
          gl.uniform2f(programs.bloom.uniforms.uTexel, texel[0], texel[1]);
          gl.uniform1f(programs.bloom.uniforms.uThreshold, 0.5);
        },
        swapTarget()
      );
    }

    // Glamour
    if (settings.glamour > 0.5) {
      drawPass(
        programs.glamour,
        () => {
          gl.uniform1f(programs.glamour.uniforms.uAmount, settings.glamour / 100);
          gl.uniform2f(programs.glamour.uniforms.uTexel, texel[0], texel[1]);
        },
        swapTarget()
      );
    }

    // Clarity
    if (Math.abs(settings.clarity) > 0.5) {
      drawPass(
        programs.clarity,
        () => {
          gl.uniform1f(programs.clarity.uniforms.uAmount, settings.clarity / 100);
          gl.uniform2f(programs.clarity.uniforms.uTexel, texel[0], texel[1]);
        },
        swapTarget()
      );
    }

    // Sharpen
    if (settings.sharpen > 0.5) {
      drawPass(
        programs.sharpen,
        () => {
          gl.uniform2f(programs.sharpen.uniforms.uTexel, texel[0], texel[1]);
          gl.uniform1f(programs.sharpen.uniforms.uAmount, settings.sharpen / 100);
          gl.uniform1fv(
            programs.sharpen.uniforms['uKernel[0]'],
            new Float32Array([0, -1, 0, -1, 5, -1, 0, -1, 0])
          );
        },
        swapTarget()
      );
    }

    // Smooth
    if (settings.smooth > 0.5) {
      drawPass(
        programs.smooth,
        () => {
          gl.uniform2f(programs.smooth.uniforms.uTexel, texel[0], texel[1]);
          gl.uniform1f(programs.smooth.uniforms.uAmount, settings.smooth / 100);
          gl.uniform1fv(
            programs.smooth.uniforms['uKernel[0]'],
            new Float32Array([
              1 / 9, 1 / 9, 1 / 9,
              1 / 9, 1 / 9, 1 / 9,
              1 / 9, 1 / 9, 1 / 9,
            ])
          );
        },
        swapTarget()
      );
    }

    // Blur (horizontal + vertical)
    const blurRadius = settings.blur;
    drawPass(
      programs.blur,
      () => {
        gl.uniform2f(programs.blur.uniforms.uSize, blurRadius / width, 0.0);
      },
      swapTarget()
    );

    drawPass(
      programs.blur,
      () => {
        gl.uniform2f(programs.blur.uniforms.uSize, 0.0, blurRadius / height);
      },
      swapTarget()
    );

    // Vignette
    drawPass(
      programs.vignette,
      () => {
        gl.uniform1f(programs.vignette.uniforms.uAmount, settings.vignette / 100);
        gl.uniform1f(programs.vignette.uniforms.uSize, 0.25);
      },
      swapTarget()
    );

    // Grain
    drawPass(
      programs.grain,
      () => {
        gl.uniform2f(programs.grain.uniforms.uResolution, width, height);
        gl.uniform1f(programs.grain.uniforms.uAmount, settings.grain / 800);
        gl.uniform1f(programs.grain.uniforms.uTime, 0);
      },
      swapTarget()
    );

    // Final pass to screen
    drawPass(programs.pass, () => {}, null);
  }
}
