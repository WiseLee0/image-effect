/**
 * WebGL 后端实现
 */

import { type CubeLUT, lutToFlat2D } from '../../lut';
import { type ColorGradingSettings, defaultLUTParams, type LUTParams } from '../../types';
import { type BackendOptions, type BackendType, BaseBackend, isWebGLSupported } from '../base';
import * as shaders from './shaders';
import type { WebGLProgramInfo, WebGLRenderTarget, WebGLResources } from './types';
import {
  buildBlackPalette,
  buildContrastMatrix,
  buildProgram,
  buildSaturationMatrix,
  createPaletteTexture,
  createRenderTarget,
  updatePaletteTexture,
} from './utils';

const SHARPEN_KERNEL = new Float32Array([0, -1, 0, -1, 5, -1, 0, -1, 0]);
const SMOOTH_KERNEL = new Float32Array([
  1 / 9,
  1 / 9,
  1 / 9,
  1 / 9,
  1 / 9,
  1 / 9,
  1 / 9,
  1 / 9,
  1 / 9,
]);

export class WebGLBackend extends BaseBackend {
  private gl: WebGLRenderingContext | null = null;
  private resources: WebGLResources | null = null;
  private lutParams: LUTParams = { ...defaultLUTParams };
  private lastBlacksPalette: number = Number.NaN;

  constructor(canvas: HTMLCanvasElement, options: BackendOptions = {}) {
    super(canvas, options);
  }

  getType(): BackendType {
    return 'webgl';
  }

  static isSupported(): boolean {
    return isWebGLSupported();
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
    const gl = this.gl;
    if (!gl) throw new Error('WebGL context not available');

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
    const gl = this.gl;
    if (!gl) throw new Error('WebGL context not available');

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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.initResources(gl, width, height, sourceTexture);
  }

  loadFromVideo(video: HTMLVideoElement): void {
    this.loadFromSource(video, video.videoWidth, video.videoHeight);
  }

  loadFromSource(
    source:
      | HTMLVideoElement
      | HTMLCanvasElement
      | OffscreenCanvas
      | ImageBitmap
      | VideoFrame,
    width: number,
    height: number,
  ): void {
    if (!this.gl) this.init();
    const gl = this.gl;
    if (!gl) throw new Error('WebGL context not available');

    if (!width || !height) {
      throw new Error('Source dimensions unavailable');
    }
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.initResources(gl, width, height, sourceTexture);
  }

  updateFromVideo(video: HTMLVideoElement): void {
    this.updateFromSource(video);
  }

  updateFromSource(
    source:
      | HTMLVideoElement
      | HTMLCanvasElement
      | OffscreenCanvas
      | ImageBitmap
      | VideoFrame,
  ): void {
    const gl = this.gl;
    if (!gl || !this.resources) {
      throw new Error('Backend not ready, call loadFromSource first');
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.resources.sourceTexture);
    // Reuse the existing texture object — texImage2D with a video element rebinds
    // the GPU storage to the new frame each call.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
  }

  setLUT(lut: CubeLUT | null): void {
    const gl = this.gl;
    if (!gl || !this.resources) {
      throw new Error('Backend not initialized');
    }
    if (this.resources.lutTexture) {
      gl.deleteTexture(this.resources.lutTexture);
      this.resources.lutTexture = null;
      this.resources.lutSize = 0;
    }
    if (!lut) return;

    const flat = lutToFlat2D(lut);
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create LUT texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      flat.width,
      flat.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      flat.data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    this.resources.lutTexture = tex;
    this.resources.lutSize = lut.size;
  }

  setLUTParams(params: LUTParams): void {
    this.lutParams = { ...params };
  }

  setSkinSegmentationMask(
    mask:
      | HTMLCanvasElement
      | OffscreenCanvas
      | HTMLImageElement
      | ImageBitmap
      | ImageData
      | null,
  ): void {
    const gl = this.gl;
    if (!gl || !this.resources) return;

    if (mask === null) {
      // 关闭语义 mask：保留纹理（避免每次重新分配显存），只翻 enabled flag
      this.resources.segMaskEnabled = false;
      return;
    }

    // 解析尺寸 + source（统一成 texImage2D / texSubImage2D 能接受的输入）
    let width: number;
    let height: number;
    if (mask instanceof ImageData) {
      width = mask.width;
      height = mask.height;
    } else if (mask instanceof HTMLImageElement) {
      width = mask.naturalWidth || mask.width;
      height = mask.naturalHeight || mask.height;
    } else {
      width = (mask as { width: number }).width;
      height = (mask as { height: number }).height;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.resources.segMaskTexture);
    // shader 内已经做了 1.0 - uv.y 的翻转，所以这里 keep flip=0 直传原始坐标
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

    const sameSize =
      this.resources.segMaskWidth === width && this.resources.segMaskHeight === height;

    if (sameSize) {
      // 热路径：稳态下 MediaPipe 持续输出 256×256，纹理尺寸不变 →
      // 用 texSubImage2D 仅写像素，不重新分配显存。
      // 注意：首次调用必然走冷路径，因为初始占位纹理是 1×1 全白，与真实 mask 尺寸不符。
      if (mask instanceof ImageData) {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          mask.width,
          mask.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          mask.data,
        );
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          mask as TexImageSource,
        );
      }
    } else {
      // 冷路径：尺寸不匹配（首次从 1×1 占位扩到 256×256，或后续换源尺寸变化）
      // → texImage2D 重新分配显存。后续同尺寸调用会自然落入热路径。
      if (mask instanceof ImageData) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          mask.width,
          mask.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          mask.data,
        );
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          mask as TexImageSource,
        );
      }
      this.resources.segMaskWidth = width;
      this.resources.segMaskHeight = height;
    }

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    this.resources.segMaskEnabled = true;
  }

  render(settings: ColorGradingSettings): void {
    if (!this.resources) {
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
    // Browsers cap concurrent WebGL contexts (~16). Releasing JS references is
    // not enough — the GPU-side context lingers until GC. Force-release via the
    // WEBGL_lose_context extension so opening/closing tabs or switching backends
    // doesn't accumulate contexts and trigger "Too many active WebGL contexts".
    if (this.gl) {
      const loseExt = this.gl.getExtension('WEBGL_lose_context');
      loseExt?.loseContext();
    }
    this.gl = null;
    this.initialized = false;
  }

  private initResources(
    gl: WebGLRenderingContext,
    width: number,
    height: number,
    sourceTexture: WebGLTexture,
  ): void {
    const blackPalette = createPaletteTexture(gl, buildBlackPalette(0));
    this.lastBlacksPalette = 0;

    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    if (!positionBuffer || !texCoordBuffer) {
      throw new Error('Failed to create buffers');
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    const vs = shaders.vertexSource;
    const blackVs = shaders.blackVertexSource;

    const programs = {
      pass: buildProgram(gl, vs, shaders.passFragment, ['uTexture']),
      vibrance: buildProgram(gl, vs, shaders.vibranceFragment, ['uTexture', 'uAmount']),
      saturation: buildProgram(gl, vs, shaders.saturationFragment, ['uTexture', 'uMatrix[0]']),
      temperature: buildProgram(gl, vs, shaders.temperatureFragment, ['uTexture', 'uAmount']),
      tint: buildProgram(gl, vs, shaders.tintFragment, ['uTexture', 'uAmount']),
      hue: buildProgram(gl, vs, shaders.hueFragment, ['uTexture', 'uRotation']),
      brightness: buildProgram(gl, vs, shaders.brightnessFragment, ['uTexture', 'uAmount']),
      exposure: buildProgram(gl, vs, shaders.exposureFragment, ['uTexture', 'uAmount']),
      contrast: buildProgram(gl, vs, shaders.contrastFragment, ['uTexture', 'uMatrix[0]']),
      blacks: buildProgram(gl, blackVs, shaders.blackPaletteFragment, [
        'uTexture',
        'uPaletteMap',
        'transform',
      ]),
      whites: buildProgram(gl, vs, shaders.whitesFragment, ['uTexture', 'uAmount']),
      highlights: buildProgram(gl, vs, shaders.highlightsFragment, ['uTexture', 'uAmount']),
      shadows: buildProgram(gl, vs, shaders.shadowsFragment, ['uTexture', 'uAmount']),
      dehaze: buildProgram(gl, vs, shaders.dehazeFragment, ['uTexture', 'uAmount', 'uSize']),
      bloom: buildProgram(gl, vs, shaders.bloomFragment, [
        'uTexture',
        'uAmount',
        'uTexel',
        'uThreshold',
      ]),
      glamour: buildProgram(gl, vs, shaders.glamourFragment, ['uTexture', 'uAmount', 'uTexel']),
      clarity: buildProgram(gl, vs, shaders.clarityFragment, ['uTexture', 'uAmount', 'uTexel']),
      sharpen: buildProgram(gl, vs, shaders.kernelFragment, [
        'uTexture',
        'uTexel',
        'uKernel[0]',
        'uAmount',
      ]),
      smooth: buildProgram(gl, vs, shaders.kernelFragment, [
        'uTexture',
        'uTexel',
        'uKernel[0]',
        'uAmount',
      ]),
      blur: buildProgram(gl, vs, shaders.blurFragment, ['uTexture', 'uSize']),
      vignette: buildProgram(gl, vs, shaders.vignetteFragment, ['uTexture', 'uAmount', 'uSize']),
      grain: buildProgram(gl, vs, shaders.grainFragment, [
        'uTexture',
        'uResolution',
        'uAmount',
        'uTime',
      ]),
      lut: buildProgram(gl, vs, shaders.lutFragment, [
        'uTexture',
        'uLUT',
        'uLUTSize',
        'uIntensity',
        'uSkinProtection',
        'uSegMask',
        'uUseSegMask',
        'uSegMaskTexel',
      ]),
    };

    const targets: [WebGLRenderTarget, WebGLRenderTarget] = [
      createRenderTarget(gl, width, height),
      createRenderTarget(gl, width, height),
    ];

    // 占位 1×1 全白 mask 纹理：未启用语义分割时让 shader 内 segMask=1
    const segMaskTexture = gl.createTexture();
    if (!segMaskTexture) throw new Error('Failed to create seg mask texture');
    gl.bindTexture(gl.TEXTURE_2D, segMaskTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    this.resources = {
      gl,
      width,
      height,
      sourceTexture,
      blackPalette,
      lutTexture: null,
      lutSize: 0,
      quad: { positionBuffer, texCoordBuffer },
      programs,
      targets,
      segMaskTexture,
      segMaskWidth: 1,
      segMaskHeight: 1,
      segMaskEnabled: false,
    };
  }

  private disposeResources(): void {
    if (!this.resources) return;

    const { gl, sourceTexture, blackPalette, lutTexture, quad, programs, targets, segMaskTexture } =
      this.resources;
    gl.deleteTexture(sourceTexture);
    gl.deleteTexture(blackPalette);
    if (lutTexture) gl.deleteTexture(lutTexture);
    gl.deleteTexture(segMaskTexture);
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
    const { gl, width, height, sourceTexture, blackPalette, quad, programs, targets } = resources;

    gl.viewport(0, 0, width, height);

    const texel = [1 / width, 1 / height] as const;
    let inputTexture = sourceTexture;
    let pingIndex = 0;

    const bindAttributes = (program: WebGLProgramInfo) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad.positionBuffer);
      const positionAttrib =
        program.attribs.aPosition >= 0 ? program.attribs.aPosition : program.attribs.apos;
      if (positionAttrib >= 0) {
        gl.enableVertexAttribArray(positionAttrib);
        gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 0, 0);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, quad.texCoordBuffer);
      const texAttrib =
        program.attribs.aTexCoord >= 0 ? program.attribs.aTexCoord : program.attribs.auv;
      if (texAttrib >= 0) {
        gl.enableVertexAttribArray(texAttrib);
        gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 0, 0);
      }
    };

    const drawPass = (
      program: WebGLProgramInfo,
      setupUniforms: () => void,
      output: WebGLRenderTarget | null,
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

    // LUT 作为流水线第一层：先把图像通过 LUT 映射，再交给后续全局调节。
    const lut = resources.lutTexture;
    const lutSize = resources.lutSize;
    if (lut && lutSize > 0 && this.lutParams.intensity > 0.005) {
      drawPass(
        programs.lut,
        () => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, lut);
          gl.uniform1i(programs.lut.uniforms.uLUT, 1);
          gl.uniform1f(programs.lut.uniforms.uLUTSize, lutSize);
          gl.uniform1f(programs.lut.uniforms.uIntensity, this.lutParams.intensity);
          gl.uniform1f(
            programs.lut.uniforms.uSkinProtection,
            Math.max(0, Math.min(1, settings.skinProtection / 100)),
          );
          // 语义肤色 mask（unit 2）+ enable flag + texel（dilate 用）
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, resources.segMaskTexture);
          gl.uniform1i(programs.lut.uniforms.uSegMask, 2);
          gl.uniform1f(programs.lut.uniforms.uUseSegMask, resources.segMaskEnabled ? 1 : 0);
          // mask 一像素的 UV 大小，dilate 9-tap 用。未启用（1×1 占位）时 (1,1) → dilate 退化。
          gl.uniform2f(
            programs.lut.uniforms.uSegMaskTexel,
            1.0 / resources.segMaskWidth,
            1.0 / resources.segMaskHeight,
          );
          gl.activeTexture(gl.TEXTURE0);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.vibrance) > 0.5) {
      drawPass(
        programs.vibrance,
        () => {
          gl.uniform1f(programs.vibrance.uniforms.uAmount, settings.vibrance / 100);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.saturation) > 0.5) {
      drawPass(
        programs.saturation,
        () => {
          const matrix = buildSaturationMatrix(settings.saturation);
          gl.uniform1fv(programs.saturation.uniforms['uMatrix[0]'], matrix);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.temperature) > 0.5) {
      drawPass(
        programs.temperature,
        () => {
          gl.uniform1f(programs.temperature.uniforms.uAmount, settings.temperature / 500);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.tint) > 0.5) {
      drawPass(
        programs.tint,
        () => {
          gl.uniform1f(programs.tint.uniforms.uAmount, settings.tint / 500);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.hue) > 0.5) {
      drawPass(
        programs.hue,
        () => {
          gl.uniform1f(programs.hue.uniforms.uRotation, settings.hue / 200);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.brightness) > 0.5) {
      drawPass(
        programs.brightness,
        () => {
          gl.uniform1f(programs.brightness.uniforms.uAmount, settings.brightness / 200);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.exposure) > 0.5) {
      drawPass(
        programs.exposure,
        () => {
          gl.uniform1f(programs.exposure.uniforms.uAmount, settings.exposure / 100);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.contrast) > 0.5) {
      drawPass(
        programs.contrast,
        () => {
          const matrix = buildContrastMatrix(settings.contrast);
          gl.uniform1fv(programs.contrast.uniforms['uMatrix[0]'], matrix);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.blacks) > 0.5) {
      if (this.lastBlacksPalette !== settings.blacks) {
        updatePaletteTexture(gl, blackPalette, buildBlackPalette(settings.blacks));
        this.lastBlacksPalette = settings.blacks;
      }
      drawPass(
        programs.blacks,
        () => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, blackPalette);
          gl.uniform1i(programs.blacks.uniforms.uPaletteMap, 1);
          gl.uniform4f(programs.blacks.uniforms.transform, 1.0, 1.0, 0.0, 0.0);
          gl.activeTexture(gl.TEXTURE0);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.whites) > 0.5) {
      drawPass(
        programs.whites,
        () => {
          gl.uniform1f(programs.whites.uniforms.uAmount, settings.whites / 400);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.highlights) > 0.5) {
      drawPass(
        programs.highlights,
        () => {
          gl.uniform1f(programs.highlights.uniforms.uAmount, settings.highlights / 100);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.shadows) > 0.5) {
      drawPass(
        programs.shadows,
        () => {
          gl.uniform1f(programs.shadows.uniforms.uAmount, settings.shadows / 100);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.dehaze) > 0.5) {
      drawPass(
        programs.dehaze,
        () => {
          gl.uniform1f(programs.dehaze.uniforms.uAmount, settings.dehaze / 100);
          gl.uniform2f(programs.dehaze.uniforms.uSize, width, height);
        },
        swapTarget(),
      );
    }

    if (settings.bloom > 0.5) {
      drawPass(
        programs.bloom,
        () => {
          gl.uniform1f(programs.bloom.uniforms.uAmount, settings.bloom / 100);
          gl.uniform2f(programs.bloom.uniforms.uTexel, texel[0], texel[1]);
          gl.uniform1f(programs.bloom.uniforms.uThreshold, 0.5);
        },
        swapTarget(),
      );
    }

    if (settings.glamour > 0.5) {
      drawPass(
        programs.glamour,
        () => {
          gl.uniform1f(programs.glamour.uniforms.uAmount, settings.glamour / 100);
          gl.uniform2f(programs.glamour.uniforms.uTexel, texel[0], texel[1]);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.clarity) > 0.5) {
      drawPass(
        programs.clarity,
        () => {
          gl.uniform1f(programs.clarity.uniforms.uAmount, settings.clarity / 100);
          gl.uniform2f(programs.clarity.uniforms.uTexel, texel[0], texel[1]);
        },
        swapTarget(),
      );
    }

    if (settings.sharpen > 0.5) {
      drawPass(
        programs.sharpen,
        () => {
          gl.uniform2f(programs.sharpen.uniforms.uTexel, texel[0], texel[1]);
          gl.uniform1f(programs.sharpen.uniforms.uAmount, settings.sharpen / 100);
          gl.uniform1fv(programs.sharpen.uniforms['uKernel[0]'], SHARPEN_KERNEL);
        },
        swapTarget(),
      );
    }

    if (settings.smooth > 0.5) {
      drawPass(
        programs.smooth,
        () => {
          gl.uniform2f(programs.smooth.uniforms.uTexel, texel[0], texel[1]);
          gl.uniform1f(programs.smooth.uniforms.uAmount, settings.smooth / 100);
          gl.uniform1fv(programs.smooth.uniforms['uKernel[0]'], SMOOTH_KERNEL);
        },
        swapTarget(),
      );
    }

    // Blur (separable horizontal + vertical)
    if (Math.abs(settings.blur) > 0.5) {
      const blurRadius = settings.blur;
      drawPass(
        programs.blur,
        () => {
          gl.uniform2f(programs.blur.uniforms.uSize, blurRadius / width, 0.0);
        },
        swapTarget(),
      );

      drawPass(
        programs.blur,
        () => {
          gl.uniform2f(programs.blur.uniforms.uSize, 0.0, blurRadius / height);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.vignette) > 0.5) {
      drawPass(
        programs.vignette,
        () => {
          gl.uniform1f(programs.vignette.uniforms.uAmount, settings.vignette / 100);
          gl.uniform1f(programs.vignette.uniforms.uSize, 0.25);
        },
        swapTarget(),
      );
    }

    if (Math.abs(settings.grain) > 0.5) {
      drawPass(
        programs.grain,
        () => {
          gl.uniform2f(programs.grain.uniforms.uResolution, width, height);
          gl.uniform1f(programs.grain.uniforms.uAmount, settings.grain / 800);
          gl.uniform1f(programs.grain.uniforms.uTime, 0);
        },
        swapTarget(),
      );
    }

    drawPass(programs.pass, () => {}, null);
  }
}

export type { WebGLProgramInfo, WebGLRenderTarget, WebGLResources } from './types';
