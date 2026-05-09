/**
 * WebGPU 后端实现
 */

import type { ColorGradingSettings } from '../../types';
import { buildBlackPalette, buildContrastMatrix, buildSaturationMatrix } from '../../utils/common';
import { type BackendOptions, type BackendType, BaseBackend } from '../base';
import * as shaders from './shaders';
import type { WebGPUPipelineInfo, WebGPURenderTarget, WebGPUResources } from './types';

export class WebGPUBackend extends BaseBackend {
  private device: GPUDevice | null = null;
  private resources: WebGPUResources | null = null;

  constructor(canvas: HTMLCanvasElement, options: BackendOptions = {}) {
    super(canvas, options);
  }

  getType(): BackendType {
    return 'webgpu';
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  async init(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No WebGPU adapter found');
    }

    this.device = await adapter.requestDevice();
    this.initialized = true;
  }

  loadFromImage(image: HTMLImageElement): void {
    if (!this.device) {
      throw new Error('WebGPU not initialized. Call init() first.');
    }

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.disposeResources();
    this.initResources(this.device, width, height, image);
  }

  loadFromImageData(imageData: ImageData): void {
    if (!this.device) {
      throw new Error('WebGPU not initialized. Call init() first.');
    }

    const { width, height } = imageData;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.disposeResources();
    this.initResourcesFromImageData(this.device, width, height, imageData);
  }

  render(settings: ColorGradingSettings): void {
    if (!this.resources) {
      console.warn('No image loaded');
      return;
    }
    this.drawFrame(this.resources, settings);
  }

  getImageData(): ImageData {
    if (!this.resources) {
      throw new Error('No image loaded');
    }

    // 从 canvas 2D context 读取（WebGPU 渲染结果已经在 canvas 上）
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) {
      throw new Error('Cannot create 2D context');
    }

    const { width, height } = this.resources;
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.drawImage(this.canvas, 0, 0);

    return ctx.getImageData(0, 0, width, height);
  }

  /**
   * 异步获取 ImageData
   */
  async getImageDataAsync(): Promise<ImageData> {
    if (!this.resources) {
      throw new Error('No image loaded');
    }

    const { device, width, height, targets } = this.resources;

    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const bufferSize = bytesPerRow * height;

    const readBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = device.createCommandEncoder();

    commandEncoder.copyTextureToBuffer(
      { texture: targets[0].texture },
      { buffer: readBuffer, bytesPerRow },
      { width, height },
    );

    device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(readBuffer.getMappedRange());

    // 处理行对齐
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcOffset = y * bytesPerRow;
      const dstOffset = y * width * 4;
      pixels.set(data.subarray(srcOffset, srcOffset + width * 4), dstOffset);
    }

    readBuffer.unmap();
    readBuffer.destroy();

    return new ImageData(pixels, width, height);
  }

  dispose(): void {
    this.disposeResources();
    // device.destroy() releases all GPU-side resources backed by this device:
    // pipelines, shader modules, samplers, bind group layouts. Texture/buffer
    // objects in `resources` are explicitly destroyed in disposeResources()
    // for early reclamation under memory pressure; everything else is freed
    // here. Without this call, opening/closing the color-adjust dialog
    // accumulates GPU device handles across the session.
    this.device?.destroy();
    this.device = null;
    this.initialized = false;
  }

  // ===== 私有方法 =====

  private getShaderSource(source: string): string {
    return source;
  }

  private createPipeline(
    device: GPUDevice,
    format: GPUTextureFormat,
    fragmentShader: string,
    hasParams: boolean = true,
    hasExtraTexture: boolean = false,
  ): WebGPUPipelineInfo {
    const entries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ];

    if (hasParams) {
      entries.push({
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      });
    }

    if (hasExtraTexture) {
      entries.push(
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      );
    }

    const bindGroupLayout = device.createBindGroupLayout({ entries });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const vertexModule = device.createShaderModule({
      code: this.getShaderSource(shaders.vertexShader),
    });

    const fragmentModule = device.createShaderModule({
      code: this.getShaderSource(fragmentShader),
    });

    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: vertexModule,
        entryPoint: 'main',
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: fragmentModule,
        entryPoint: 'main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-strip',
      },
    });

    return { pipeline, bindGroupLayout, hasUniform: hasParams, hasExtraTexture };
  }

  private createRenderTarget(
    device: GPUDevice,
    width: number,
    height: number,
    format: GPUTextureFormat,
  ): WebGPURenderTarget {
    const texture = device.createTexture({
      size: { width, height },
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC,
    });
    return {
      texture,
      view: texture.createView(),
    };
  }

  private initResources(
    device: GPUDevice,
    width: number,
    height: number,
    image: HTMLImageElement,
  ): void {
    const context = this.canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to get WebGPU context');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    // 创建源纹理
    const sourceTexture = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // 使用 canvas 获取图像数据
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) throw new Error('Failed to get 2d context');
    tempCtx.drawImage(image, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, width, height);

    device.queue.writeTexture(
      { texture: sourceTexture },
      imageData.data,
      { bytesPerRow: width * 4 },
      { width, height },
    );

    this.setupResources(device, context, format, width, height, sourceTexture);
  }

  private initResourcesFromImageData(
    device: GPUDevice,
    width: number,
    height: number,
    imageData: ImageData,
  ): void {
    const context = this.canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to get WebGPU context');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const sourceTexture = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.writeTexture(
      { texture: sourceTexture },
      imageData.data,
      { bytesPerRow: width * 4 },
      { width, height },
    );

    this.setupResources(device, context, format, width, height, sourceTexture);
  }

  private setupResources(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    width: number,
    height: number,
    sourceTexture: GPUTexture,
  ): void {
    // 创建采样器
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // 创建顶点缓冲区
    const vertices = new Float32Array([
      -1,
      -1,
      0,
      1, // position, uv (flip y)
      1,
      -1,
      1,
      1,
      -1,
      1,
      0,
      0,
      1,
      1,
      1,
      0,
    ]);
    const vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, vertices);

    // 中间渲染使用 rgba8unorm 格式
    const intermediateFormat: GPUTextureFormat = 'rgba8unorm';

    // 创建管线（中间渲染用 rgba8unorm，最终输出用 canvas 格式）
    const pipelines: Record<string, WebGPUPipelineInfo> = {
      // 最终输出到 canvas 的 pass 管线使用 canvas 格式
      pass: this.createPipeline(device, format, shaders.passFragment, false),
      // 其他管线使用 rgba8unorm 格式（与渲染目标匹配）
      vibrance: this.createPipeline(device, intermediateFormat, shaders.vibranceFragment),
      saturation: this.createPipeline(device, intermediateFormat, shaders.saturationFragment),
      temperature: this.createPipeline(device, intermediateFormat, shaders.temperatureFragment),
      tint: this.createPipeline(device, intermediateFormat, shaders.tintFragment),
      hue: this.createPipeline(device, intermediateFormat, shaders.hueFragment),
      brightness: this.createPipeline(device, intermediateFormat, shaders.brightnessFragment),
      exposure: this.createPipeline(device, intermediateFormat, shaders.exposureFragment),
      contrast: this.createPipeline(device, intermediateFormat, shaders.contrastFragment),
      blacks: this.createPipeline(device, intermediateFormat, shaders.blacksFragment, false, true),
      whites: this.createPipeline(device, intermediateFormat, shaders.whitesFragment),
      highlights: this.createPipeline(device, intermediateFormat, shaders.highlightsFragment),
      shadows: this.createPipeline(device, intermediateFormat, shaders.shadowsFragment),
      dehaze: this.createPipeline(device, intermediateFormat, shaders.dehazeFragment),
      bloom: this.createPipeline(device, intermediateFormat, shaders.bloomFragment),
      glamour: this.createPipeline(device, intermediateFormat, shaders.glamourFragment),
      clarity: this.createPipeline(device, intermediateFormat, shaders.clarityFragment),
      kernel: this.createPipeline(device, intermediateFormat, shaders.kernelFragment),
      blur: this.createPipeline(device, intermediateFormat, shaders.blurFragment),
      vignette: this.createPipeline(device, intermediateFormat, shaders.vignetteFragment),
      grain: this.createPipeline(device, intermediateFormat, shaders.grainFragment),
    };

    // 创建 palette texture 用于 blacks 效果
    const paletteTexture = device.createTexture({
      size: { width: 256, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // 创建渲染目标
    const targets: [WebGPURenderTarget, WebGPURenderTarget] = [
      this.createRenderTarget(device, width, height, 'rgba8unorm'),
      this.createRenderTarget(device, width, height, 'rgba8unorm'),
    ];

    // Pre-allocate one persistent uniform buffer per pipeline that needs it.
    // Largest uniform payload is the kernel pass at 64 bytes; pad to 256 for
    // alignment and headroom. Reused every frame via writeBuffer (avoids
    // 21 createBuffer/destroy round-trips per render).
    const uniformBuffers: Record<string, GPUBuffer> = {};
    const bindGroupCache = new Map<string, Map<GPUTextureView, GPUBindGroup>>();
    for (const [name, info] of Object.entries(pipelines)) {
      bindGroupCache.set(name, new Map());
      if (info.hasUniform) {
        uniformBuffers[name] = device.createBuffer({
          size: 256,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      }
    }

    this.resources = {
      device,
      context,
      format,
      width,
      height,
      sourceTexture,
      sourceTextureView: sourceTexture.createView(),
      sampler,
      vertexBuffer,
      pipelines,
      targets,
      paletteTexture,
      paletteTextureView: paletteTexture.createView(),
      uniformBuffers,
      bindGroupCache,
    };
  }

  private disposeResources(): void {
    if (!this.resources) return;

    const { context, sourceTexture, vertexBuffer, targets, paletteTexture, uniformBuffers } =
      this.resources;

    sourceTexture.destroy();
    vertexBuffer.destroy();
    for (const t of targets) {
      t.texture.destroy();
    }
    if (paletteTexture) paletteTexture.destroy();
    for (const buf of Object.values(uniformBuffers)) {
      buf.destroy();
    }
    // Detach the canvas from the device so the swap-chain stops holding a
    // reference to the about-to-be-destroyed device.
    try {
      context.unconfigure();
    } catch {
      // unconfigure() is safe to skip if the context was already torn down.
    }

    this.resources = null;
  }

  private drawFrame(resources: WebGPUResources, settings: ColorGradingSettings): void {
    const {
      device,
      context,
      width,
      height,
      sourceTextureView,
      sampler,
      vertexBuffer,
      pipelines,
      targets,
      paletteTexture,
      paletteTextureView,
      uniformBuffers,
      bindGroupCache,
    } = resources;

    let inputTextureView = sourceTextureView;
    let pingIndex = 0;

    const commandEncoder = device.createCommandEncoder();

    const swapTarget = (): WebGPURenderTarget => {
      const target = targets[pingIndex % 2];
      pingIndex++;
      return target;
    };

    const getOrCreateBindGroup = (
      pipelineName: string,
      pipelineInfo: WebGPUPipelineInfo,
      inputView: GPUTextureView,
    ): GPUBindGroup => {
      const cache = bindGroupCache.get(pipelineName);
      if (!cache) {
        throw new Error(`No bindGroup cache for pipeline ${pipelineName}`);
      }
      const cached = cache.get(inputView);
      if (cached) return cached;

      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: inputView },
        { binding: 1, resource: sampler },
      ];
      if (pipelineInfo.hasUniform) {
        entries.push({ binding: 2, resource: { buffer: uniformBuffers[pipelineName] } });
      }
      if (pipelineInfo.hasExtraTexture) {
        if (!paletteTextureView) {
          throw new Error('Pipeline requires palette texture but none allocated');
        }
        entries.push(
          { binding: 2, resource: paletteTextureView },
          { binding: 3, resource: sampler },
        );
      }

      const bindGroup = device.createBindGroup({
        layout: pipelineInfo.bindGroupLayout,
        entries,
      });
      cache.set(inputView, bindGroup);
      return bindGroup;
    };

    const runPass = (
      pipelineName: string,
      uniformData?: ArrayBufferLike,
      outputView?: GPUTextureView,
    ) => {
      const pipelineInfo = pipelines[pipelineName];
      if (!pipelineInfo) return;

      const target = outputView ? null : swapTarget();
      const targetView = outputView || target?.view;
      if (!targetView) return;

      if (uniformData) {
        device.queue.writeBuffer(uniformBuffers[pipelineName], 0, uniformData as ArrayBuffer);
      }

      const bindGroup = getOrCreateBindGroup(pipelineName, pipelineInfo, inputTextureView);

      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });

      passEncoder.setPipeline(pipelineInfo.pipeline);
      passEncoder.setVertexBuffer(0, vertexBuffer);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(4);
      passEncoder.end();

      if (target) {
        inputTextureView = target.view;
      }
    };

    // Vibrance
    if (Math.abs(settings.vibrance) > 0.5) {
      const data = new Float32Array([settings.vibrance / 100]);
      runPass('vibrance', data.buffer);
    }

    // Saturation
    if (Math.abs(settings.saturation) > 0.5) {
      const matrix = buildSaturationMatrix(settings.saturation);
      runPass('saturation', matrix.buffer);
    }

    // Temperature
    if (Math.abs(settings.temperature) > 0.5) {
      const data = new Float32Array([settings.temperature / 500]);
      runPass('temperature', data.buffer);
    }

    // Tint
    if (Math.abs(settings.tint) > 0.5) {
      const data = new Float32Array([settings.tint / 500]);
      runPass('tint', data.buffer);
    }

    // Hue
    if (Math.abs(settings.hue) > 0.5) {
      const data = new Float32Array([settings.hue / 200]);
      runPass('hue', data.buffer);
    }

    // Brightness
    if (Math.abs(settings.brightness) > 0.5) {
      const data = new Float32Array([settings.brightness / 200]);
      runPass('brightness', data.buffer);
    }

    // Exposure
    if (Math.abs(settings.exposure) > 0.5) {
      const data = new Float32Array([settings.exposure / 100]);
      runPass('exposure', data.buffer);
    }

    // Contrast
    if (Math.abs(settings.contrast) > 0.5) {
      const matrix = buildContrastMatrix(settings.contrast);
      runPass('contrast', matrix.buffer);
    }

    // Blacks - palette texture 作为额外 binding，由 bindGroupCache 自动复用
    if (Math.abs(settings.blacks) > 0.5 && paletteTexture && paletteTextureView) {
      const paletteData = buildBlackPalette(settings.blacks);
      const rgbaData = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        rgbaData[i * 4] = paletteData[i * 3];
        rgbaData[i * 4 + 1] = paletteData[i * 3 + 1];
        rgbaData[i * 4 + 2] = paletteData[i * 3 + 2];
        rgbaData[i * 4 + 3] = 255;
      }
      device.queue.writeTexture(
        { texture: paletteTexture },
        rgbaData,
        { bytesPerRow: 256 * 4 },
        { width: 256, height: 1 },
      );
      runPass('blacks');
    }

    // Whites
    if (Math.abs(settings.whites) > 0.5) {
      const data = new Float32Array([settings.whites / 400]);
      runPass('whites', data.buffer);
    }

    // Highlights
    if (Math.abs(settings.highlights) > 0.5) {
      const data = new Float32Array([settings.highlights / 100]);
      runPass('highlights', data.buffer);
    }

    // Shadows
    if (Math.abs(settings.shadows) > 0.5) {
      const data = new Float32Array([settings.shadows / 100]);
      runPass('shadows', data.buffer);
    }

    // Dehaze
    if (Math.abs(settings.dehaze) > 0.5) {
      const data = new Float32Array([settings.dehaze / 100, width, height, 0]);
      runPass('dehaze', data.buffer);
    }

    // Bloom
    if (settings.bloom > 0.5) {
      const data = new Float32Array([settings.bloom / 100, 1 / width, 1 / height, 0.5]);
      runPass('bloom', data.buffer);
    }

    // Glamour
    if (settings.glamour > 0.5) {
      const data = new Float32Array([settings.glamour / 100, 1 / width, 1 / height, 0]);
      runPass('glamour', data.buffer);
    }

    // Clarity
    if (Math.abs(settings.clarity) > 0.5) {
      const data = new Float32Array([settings.clarity / 100, 1 / width, 1 / height, 0]);
      runPass('clarity', data.buffer);
    }

    // Sharpen
    if (settings.sharpen > 0.5) {
      const data = new Float32Array([
        1 / width,
        1 / height,
        settings.sharpen / 100,
        0,
        0,
        -1,
        0,
        -1,
        5,
        -1,
        0,
        -1,
        0,
        0,
        0,
        0,
      ]);
      runPass('kernel', data.buffer);
    }

    // Smooth
    if (settings.smooth > 0.5) {
      const k = 1 / 9;
      const data = new Float32Array([
        1 / width,
        1 / height,
        settings.smooth / 100,
        0,
        k,
        k,
        k,
        k,
        k,
        k,
        k,
        k,
        k,
        0,
        0,
        0,
      ]);
      runPass('kernel', data.buffer);
    }

    // Blur (horizontal + vertical)
    if (Math.abs(settings.blur) > 0.5) {
      runPass('blur', new Float32Array([settings.blur / width, 0, 0, 0]).buffer);
      runPass('blur', new Float32Array([0, settings.blur / height, 0, 0]).buffer);
    }

    // Vignette
    if (Math.abs(settings.vignette) > 0.5) {
      const data = new Float32Array([settings.vignette / 100, 0.25, 0, 0]);
      runPass('vignette', data.buffer);
    }

    // Grain
    if (Math.abs(settings.grain) > 0.5) {
      const data = new Float32Array([width, height, settings.grain / 800, 0]);
      runPass('grain', data.buffer);
    }

    // Final pass to canvas
    const canvasTexture = context.getCurrentTexture();
    runPass('pass', undefined, canvasTexture.createView());

    device.queue.submit([commandEncoder.finish()]);
  }
}

export type { WebGPUPipelineInfo, WebGPURenderTarget, WebGPUResources } from './types';
