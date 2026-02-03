/**
 * WebGL 后端实现
 */

import { BaseBackend, type BackendType, type BackendOptions } from '../base';
import type { ColorGradingSettings } from '../../types';
import type { WebGLProgramInfo, WebGLRenderTarget, WebGLResources } from './types';
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

export class WebGLBackend extends BaseBackend {
  private gl: WebGLRenderingContext | null = null;
  private resources: WebGLResources | null = null;

  constructor(canvas: HTMLCanvasElement, options: BackendOptions = {}) {
    super(canvas, options);
  }

  getType(): BackendType {
    return 'webgl';
  }

  static isSupported(): boolean {
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

  init(): void {
    this.gl = this.canvas.getContext('webgl', {
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }
    this.initialized = true;
  }

  loadFromImage(image: HTMLImageElement): void {
    if (!this.gl) this.init();
    const gl = this.gl!;

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.disposeResources();

    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, width, height);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    const sourceTexture = gl.createTexture();
    if (!sourceTexture) throw new Error('Failed to create texture');

    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.initResources(gl, width, height, sourceTexture);
  }

  loadFromImageData(imageData: ImageData): void {
    if (!this.gl) this.init();
    const gl = this.gl!;

    const { width, height, data } = imageData;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

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

  render(settings: ColorGradingSettings): void {
    if (!this.resources) {
      console.warn('No image loaded');
      return;
    }
    this.drawFrame(this.resources, settings);
  }

  getImageData(): ImageData {
    const gl = this.gl;
    if (gl) {
      const pixels = new Uint8ClampedArray(this.width * this.height * 4);
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return new ImageData(pixels, this.width, this.height);
    }
    throw new Error('Cannot get ImageData');
  }

  dispose(): void {
    this.disposeResources();
    this.gl = null;
    this.initialized = false;
  }

  // ===== 私有方法 =====

  private getShaderSource(source: string): string {
    return source;
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

    const vs = this.getShaderSource(shaders.vertexSource);
    const blackVs = this.getShaderSource(shaders.blackVertexSource);

    const programs = {
      pass: buildProgram(gl, vs, this.getShaderSource(shaders.passFragment), ['uTexture']),
      vibrance: buildProgram(gl, vs, this.getShaderSource(shaders.vibranceFragment), ['uTexture', 'uAmount']),
      saturation: buildProgram(gl, vs, this.getShaderSource(shaders.saturationFragment), ['uTexture', 'uMatrix[0]']),
      temperature: buildProgram(gl, vs, this.getShaderSource(shaders.temperatureFragment), ['uTexture', 'uAmount']),
      tint: buildProgram(gl, vs, this.getShaderSource(shaders.tintFragment), ['uTexture', 'uAmount']),
      hue: buildProgram(gl, vs, this.getShaderSource(shaders.hueFragment), ['uTexture', 'uRotation']),
      brightness: buildProgram(gl, vs, this.getShaderSource(shaders.brightnessFragment), ['uTexture', 'uAmount']),
      exposure: buildProgram(gl, vs, this.getShaderSource(shaders.exposureFragment), ['uTexture', 'uAmount']),
      contrast: buildProgram(gl, vs, this.getShaderSource(shaders.contrastFragment), ['uTexture', 'uMatrix[0]']),
      blacks: buildProgram(gl, blackVs, this.getShaderSource(shaders.blackPaletteFragment), [
        'uTexture',
        'uPaletteMap',
        'transform',
      ]),
      whites: buildProgram(gl, vs, this.getShaderSource(shaders.whitesFragment), ['uTexture', 'uAmount']),
      highlights: buildProgram(gl, vs, this.getShaderSource(shaders.highlightsFragment), ['uTexture', 'uAmount']),
      shadows: buildProgram(gl, vs, this.getShaderSource(shaders.shadowsFragment), ['uTexture', 'uAmount']),
      dehaze: buildProgram(gl, vs, this.getShaderSource(shaders.dehazeFragment), ['uTexture', 'uAmount', 'uSize']),
      bloom: buildProgram(gl, vs, this.getShaderSource(shaders.bloomFragment), ['uTexture', 'uAmount', 'uTexel', 'uThreshold']),
      glamour: buildProgram(gl, vs, this.getShaderSource(shaders.glamourFragment), ['uTexture', 'uAmount', 'uTexel']),
      clarity: buildProgram(gl, vs, this.getShaderSource(shaders.clarityFragment), ['uTexture', 'uAmount', 'uTexel']),
      sharpen: buildProgram(gl, vs, this.getShaderSource(shaders.kernelFragment), ['uTexture', 'uTexel', 'uKernel[0]', 'uAmount']),
      smooth: buildProgram(gl, vs, this.getShaderSource(shaders.kernelFragment), ['uTexture', 'uTexel', 'uKernel[0]', 'uAmount']),
      blur: buildProgram(gl, vs, this.getShaderSource(shaders.blurFragment), ['uTexture', 'uSize']),
      vignette: buildProgram(gl, vs, this.getShaderSource(shaders.vignetteFragment), ['uTexture', 'uAmount', 'uSize']),
      grain: buildProgram(gl, vs, this.getShaderSource(shaders.grainFragment), ['uTexture', 'uResolution', 'uAmount', 'uTime']),
    };

    const targets: [WebGLRenderTarget, WebGLRenderTarget] = [
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

    const bindAttributes = (program: WebGLProgramInfo) => {
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
      program: WebGLProgramInfo,
      setupUniforms: () => void,
      output: WebGLRenderTarget | null
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

export type { WebGLResources, WebGLProgramInfo, WebGLRenderTarget } from './types';
