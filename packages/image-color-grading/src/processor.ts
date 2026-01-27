import type {
  ColorGradingSettings,
  PartialColorGradingSettings,
  ProgramInfo,
  RenderTarget,
  WebGLResources,
  ExportOptions,
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
