/**
 * WebGPU 后端实现
 */

import { type CubeLUT, lutToRGBA8 } from '../../lut';
import { type ColorGradingSettings, defaultLUTParams, type LUTParams } from '../../types';
import { buildBlackPalette, buildContrastMatrix, buildSaturationMatrix } from '../../utils/common';
import { type BackendOptions, type BackendType, BaseBackend } from '../base';
import * as shaders from './shaders';
import type {
  WebGPULUTPipelineInfo,
  WebGPUPipelineInfo,
  WebGPURenderTarget,
  WebGPUResources,
} from './types';

export class WebGPUBackend extends BaseBackend {
  private device: GPUDevice | null = null;
  private resources: WebGPUResources | null = null;
  private lutParams: LUTParams = { ...defaultLUTParams };

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

  loadFromVideo(video: HTMLVideoElement): void {
    if (!this.device) {
      throw new Error('WebGPU not initialized. Call init() first.');
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error('Video dimensions unavailable; ensure video metadata is loaded');
    }
    if (video.readyState < 2 /* HAVE_CURRENT_DATA */) {
      throw new Error('Video has no decoded frame yet; wait for readyState >= HAVE_CURRENT_DATA');
    }
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.disposeResources();

    const context = this.canvas.getContext('webgpu');
    if (!context) throw new Error('Failed to get WebGPU context');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: this.device, format, alphaMode: 'opaque' });

    const sourceTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.device.queue.copyExternalImageToTexture(
      { source: video },
      { texture: sourceTexture },
      { width, height },
    );

    this.setupResources(this.device, context, format, width, height, sourceTexture);
  }

  updateFromVideo(video: HTMLVideoElement): void {
    if (!this.device || !this.resources) {
      throw new Error('Backend not ready, call loadFromVideo first');
    }
    // 视频暂态无解码帧（暂停/seek 中、解码器流水线掉帧），跳过本次拷贝以免抛错
    if (video.readyState < 2 /* HAVE_CURRENT_DATA */) return;
    this.device.queue.copyExternalImageToTexture(
      { source: video },
      { texture: this.resources.sourceTexture },
      { width: this.resources.width, height: this.resources.height },
    );
  }

  setLUT(lut: CubeLUT | null): void {
    if (!this.device || !this.resources) {
      throw new Error('Backend not initialized');
    }
    // The cached LUT bind groups reference the old lut.view; if we destroy the
    // texture without invalidating them, the next submit hits "Destroyed
    // texture used in a submit" because the cache key (inputTextureView) is
    // still alive while the bound LUT view points to freed GPU memory.
    this.resources.bindGroupCache.get('lut')?.clear();
    if (this.resources.lut) {
      this.resources.lut.texture.destroy();
      this.resources.lut = null;
    }
    if (!lut) return;

    const rgba = lutToRGBA8(lut);
    const texture = this.device.createTexture({
      dimension: '3d',
      size: { width: lut.size, height: lut.size, depthOrArrayLayers: lut.size },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture },
      rgba,
      { bytesPerRow: lut.size * 4, rowsPerImage: lut.size },
      { width: lut.size, height: lut.size, depthOrArrayLayers: lut.size },
    );

    const sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });

    this.resources.lut = {
      texture,
      view: texture.createView(),
      sampler,
      size: lut.size,
    };
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
    if (!this.device || !this.resources) return;

    if (mask === null) {
      // 关闭语义 mask：保留现有纹理（避免 destroy → 重建 + 清缓存的开销），
      // 只翻 enabled flag。shader 内 useSegMask=0 时纹理本身不参与运算。
      this.resources.segMaskEnabled = false;
      return;
    }

    // 解析尺寸 + 归一化 source
    let source: HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | ImageBitmap;
    let width: number;
    let height: number;
    if (mask instanceof ImageData) {
      const c =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(mask.width, mask.height)
          : (() => {
              const el = document.createElement('canvas');
              el.width = mask.width;
              el.height = mask.height;
              return el;
            })();
      const ctx = c.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      ctx?.putImageData(mask, 0, 0);
      source = c as HTMLCanvasElement | OffscreenCanvas;
      width = mask.width;
      height = mask.height;
    } else if (mask instanceof HTMLImageElement) {
      source = mask;
      width = mask.naturalWidth || mask.width;
      height = mask.naturalHeight || mask.height;
    } else {
      source = mask;
      width = (mask as { width: number }).width;
      height = (mask as { height: number }).height;
    }

    const cur = this.resources.segMaskTexture;
    const sameSize = cur.width === width && cur.height === height;

    if (sameSize) {
      // 热路径：同尺寸（MediaPipe 一直输出 256×256）→ 直接覆盖现有纹理内容
      // 不 destroy/不重建 view/不清 bind group 缓存，避免每帧打断 GPU 流水线
      this.device.queue.copyExternalImageToTexture(
        { source: source as ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas },
        { texture: cur },
        { width, height },
      );
      this.resources.segMaskEnabled = true;
      return;
    }

    // 冷路径：尺寸变了（首次或换源）→ 重建。这种情况下 bind group cache 必须失效。
    this.resources.bindGroupCache.get('lut')?.clear();
    cur.destroy();
    const tex = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: source as ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas },
      { texture: tex },
      { width, height },
    );
    this.resources.segMaskTexture = tex;
    this.resources.segMaskView = tex.createView();
    this.resources.segMaskEnabled = true;
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

  private createLUTPipeline(
    device: GPUDevice,
    format: GPUTextureFormat,
  ): WebGPULUTPipelineInfo {
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '3d' },
        },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        // 语义肤色 mask（2D，R 通道）
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const vertexModule = device.createShaderModule({ code: shaders.vertexShader });
    const fragmentModule = device.createShaderModule({ code: shaders.lutFragment });

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
      primitive: { topology: 'triangle-strip' },
    });

    return { pipeline, bindGroupLayout };
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

    // LUT pipeline + 专用 uniform buffer
    const lutPipeline = this.createLUTPipeline(device, intermediateFormat);
    bindGroupCache.set('lut', new Map());
    const lutUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 占位 1×1 全白 mask 纹理：未启用语义分割时让 shader 内 segMask = 1.0
    const segMaskTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: segMaskTexture },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );
    const segMaskSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

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
      lutPipeline,
      lut: null,
      lutUniformBuffer,
      targets,
      paletteTexture,
      paletteTextureView: paletteTexture.createView(),
      uniformBuffers,
      bindGroupCache,
      segMaskTexture,
      segMaskView: segMaskTexture.createView(),
      segMaskSampler,
      segMaskEnabled: false,
    };
  }

  private disposeResources(): void {
    if (!this.resources) return;

    const {
      context,
      sourceTexture,
      vertexBuffer,
      targets,
      paletteTexture,
      uniformBuffers,
      lut,
      lutUniformBuffer,
      segMaskTexture,
    } = this.resources;

    sourceTexture.destroy();
    vertexBuffer.destroy();
    for (const t of targets) {
      t.texture.destroy();
    }
    if (paletteTexture) paletteTexture.destroy();
    if (lut) lut.texture.destroy();
    lutUniformBuffer.destroy();
    segMaskTexture.destroy();
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

    // LUT 作为流水线第一层：先把图像通过 LUT 映射，再交给后续全局调节。
    // 独立 bind layout，手动跑一次 pass，bind group 仍按 inputTextureView 缓存复用。
    const lut = resources.lut;
    if (lut && this.lutParams.intensity > 0.005) {
      const lutTarget = swapTarget();
      const cache = bindGroupCache.get('lut')!;
      let bindGroup = cache.get(inputTextureView);
      if (!bindGroup) {
        bindGroup = device.createBindGroup({
          layout: resources.lutPipeline.bindGroupLayout,
          entries: [
            { binding: 0, resource: inputTextureView },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: resources.lutUniformBuffer } },
            { binding: 3, resource: lut.view },
            { binding: 4, resource: lut.sampler },
            { binding: 5, resource: resources.segMaskView },
            { binding: 6, resource: resources.segMaskSampler },
          ],
        });
        cache.set(inputTextureView, bindGroup);
      }
      const params = new Float32Array([
        this.lutParams.intensity,
        Math.max(0, Math.min(1, settings.skinProtection / 100)),
        resources.segMaskEnabled ? 1 : 0,
        0,
      ]);
      device.queue.writeBuffer(resources.lutUniformBuffer, 0, params.buffer);

      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: lutTarget.view,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
      passEncoder.setPipeline(resources.lutPipeline.pipeline);
      passEncoder.setVertexBuffer(0, vertexBuffer);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(4);
      passEncoder.end();
      inputTextureView = lutTarget.view;
    }

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
