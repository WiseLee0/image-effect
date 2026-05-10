/**
 * MediaPipe SelfieMulticlass 肤色分割器
 *
 * 使用 SelfieMulticlass 256×256 模型，输出 6 类语义：
 *   0 = background, 1 = hair, 2 = body-skin, 3 = face-skin, 4 = clothes, 5 = others
 * 把类别 2 + 3 合并作为皮肤 mask（剪映 SkinSegmentation 同款思路）。
 *
 * 加载链路：
 *   1. 动态 import @mediapipe/tasks-vision（避免阻塞主包加载）
 *   2. 从 jsdelivr CDN 拉 wasm runtime
 *   3. 从 google storage 拉 .tflite 模型（~1.5MB）
 *   4. 创建 ImageSegmenter (delegate=GPU)，绑定一个 OffscreenCanvas+WebGL2 context
 *   5. 创建 DrawingUtils 用于把 categoryMask 直接 GPU 渲染成 RGBA mask
 *
 * 失败策略：所有错误内部捕获，segment() 返回 null，由调用方降级到像素 mask。
 *
 * GPU 快路径（默认）：MPMask → drawCategoryMask → transferToImageBitmap → ImageBitmap
 *   主线程开销 < 1.5ms，无 GPU sync。
 * CPU 慢路径（回落）：MPMask.getAsUint8Array → LUT → putImageData → OffscreenCanvas
 *   主线程开销 3-7ms，含 GPU→CPU readback stall。
 */

import type {
  SkinSegmenterOptions,
  SkinSegmentationProvider,
  SkinSegmentationResult,
  SkinSegmentationSource,
} from './types';

const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

const DEFAULT_WASM_FILESET =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

// SelfieMulticlass 类别索引 → RGBA 颜色，喂给 DrawingUtils.drawCategoryMask。
// 6 类必须全部覆盖（MediaPipe 要求 colorMap 完整），皮肤(2,3)→白，其他→黑。
const SKIN_COLOR_MAP: Map<number, [number, number, number, number]> = new Map([
  [0, [0, 0, 0, 255]], // background
  [1, [0, 0, 0, 255]], // hair
  [2, [255, 255, 255, 255]], // body-skin
  [3, [255, 255, 255, 255]], // face-skin
  [4, [0, 0, 0, 255]], // clothes
  [5, [0, 0, 0, 255]], // others
]);

// CPU 慢路径用：类别索引 → RGBA32 LUT（小端：0xAABBGGRR），buildSkinMaskCPU 内部使用。
const SKIN_RGBA_LUT_CPU = (() => {
  const lut = new Uint32Array(256);
  lut.fill(0xff000000); // 非皮肤：黑
  lut[2] = 0xffffffff;
  lut[3] = 0xffffffff;
  return lut;
})();

export class MediaPipeSkinSegmenter implements SkinSegmentationProvider {
  private readonly options: Required<SkinSegmenterOptions>;
  private segmenter: unknown = null; // ImageSegmenter
  private initPromise: Promise<void> | null = null;
  private failed = false;

  // GPU 快路径资源
  private mpCanvas: OffscreenCanvas | null = null;
  private mpGl: WebGL2RenderingContext | null = null;
  private drawingUtils: { drawCategoryMask: Function; close?: () => void } | null = null;
  // 路径选择标志：init 探测后决定。任何一次 GPU 路径失败都会永久翻成 false
  private useGpuPath = false;

  // CPU 慢路径资源（fallback 用）
  private maskCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private maskCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private maskImageData: ImageData | null = null;
  private maskImageData32: Uint32Array | null = null;

  // 防止 segmentVideo 时序错乱导致 timestamp 倒退（MediaPipe 会拒绝倒退的 timestamp）
  private lastVideoTimestamp = -1;
  // 同时只允许一个分割进行中：视频帧率高于推理速度时，丢弃中间帧
  private inflight = false;

  constructor(options: SkinSegmenterOptions = {}) {
    this.options = {
      modelAssetPath: options.modelAssetPath ?? DEFAULT_MODEL_URL,
      wasmFileset: options.wasmFileset ?? DEFAULT_WASM_FILESET,
      delegate: options.delegate ?? 'GPU',
      runningMode: options.runningMode ?? 'IMAGE',
    };
  }

  isReady(): boolean {
    return this.segmenter !== null && !this.failed;
  }

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init().catch((err) => {
      console.warn('[skin-segmenter] init failed, will fall back to pixel mask:', err);
      this.failed = true;
    });
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    // 动态 import：避免主包必须加载 mediapipe
    const mod = await import('@mediapipe/tasks-vision');
    const { FilesetResolver, ImageSegmenter, DrawingUtils } = mod;

    // 探测 GPU 快路径：需要 WebGL2 OffscreenCanvas。
    // Safari < 16.4 不支持 WebGL2 OffscreenCanvas，会回退到 CPU 慢路径。
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const c = new OffscreenCanvas(256, 256);
        // premultipliedAlpha:false 保证白/黑 mask 的 RGB 不被 alpha 反向乘进去；
        // preserveDrawingBuffer:false 避免 transferToImageBitmap 后的额外保留开销。
        const gl = c.getContext('webgl2', {
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
        }) as WebGL2RenderingContext | null;
        if (gl) {
          this.mpCanvas = c;
          this.mpGl = gl;
        }
      } catch {
        // 创建失败就回退
      }
    }

    const fileset = await FilesetResolver.forVisionTasks(this.options.wasmFileset);
    this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: this.options.modelAssetPath,
        delegate: this.options.delegate,
      },
      // 把我们自己的 OffscreenCanvas 给 MediaPipe；它会复用上面的 WebGL2 context 跑 GPU 推理，
      // 这样输出的 MPMask 与 DrawingUtils 在同一个 GL context 上，drawCategoryMask 才能直接采样。
      canvas: this.mpCanvas ?? undefined,
      runningMode: this.options.runningMode,
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    } as Parameters<typeof ImageSegmenter.createFromOptions>[1]);

    if (this.mpGl) {
      try {
        this.drawingUtils = new DrawingUtils(this.mpGl) as unknown as {
          drawCategoryMask: Function;
          close?: () => void;
        };
        this.useGpuPath = true;
      } catch (e) {
        // DrawingUtils 构造失败（极罕见），保留 mpCanvas 让 GC，走 CPU 路径
        console.warn('[skin-segmenter] DrawingUtils init failed, using CPU path:', e);
        this.useGpuPath = false;
      }
    }
  }

  async segment(source: SkinSegmentationSource): Promise<SkinSegmentationResult | null> {
    if (this.options.runningMode !== 'IMAGE') return null;
    if (!this.segmenter) {
      await this.init();
    }
    if (!this.segmenter || this.failed) return null;

    return new Promise((resolve) => {
      try {
        const segmenter = this.segmenter as {
          segment: (
            src: SkinSegmentationSource,
            cb: (result: { categoryMask?: MPMaskLike; close?: () => void }) => void
          ) => void;
        };
        segmenter.segment(source, (result) => {
          try {
            const out = this.buildSkinMask(result.categoryMask);
            result.categoryMask?.close?.();
            resolve(out);
          } catch (err) {
            console.warn('[skin-segmenter] postprocess failed:', err);
            resolve(null);
          }
        });
      } catch (err) {
        console.warn('[skin-segmenter] segment threw:', err);
        resolve(null);
      }
    });
  }

  async segmentVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): Promise<SkinSegmentationResult | null> {
    if (this.options.runningMode !== 'VIDEO') return null;
    if (!this.segmenter || this.failed) return null;
    // 拒绝并发，丢弃过期帧
    if (this.inflight) return null;
    // MediaPipe VIDEO 模式要求 timestamp 严格单调递增。
    // 大幅倒退（> 1s）通常意味着换源或视频 seek 到很远的位置，
    // 这种场景下原有 lastVideoTimestamp 已无意义，直接以新值为基准重新开始；
    // 否则（小幅抖动、currentTime 精度问题）按递增 +1 强制保单调。
    if (timestampMs <= this.lastVideoTimestamp - 1000) {
      this.lastVideoTimestamp = timestampMs;
    } else if (timestampMs <= this.lastVideoTimestamp) {
      timestampMs = this.lastVideoTimestamp + 1;
    }
    this.lastVideoTimestamp = timestampMs;
    this.inflight = true;

    return new Promise((resolve) => {
      try {
        const segmenter = this.segmenter as {
          segmentForVideo: (
            src: HTMLVideoElement,
            ts: number,
            cb: (result: { categoryMask?: MPMaskLike; close?: () => void }) => void,
          ) => void;
        };
        segmenter.segmentForVideo(video, timestampMs, (result) => {
          try {
            const out = this.buildSkinMask(result.categoryMask);
            result.categoryMask?.close?.();
            this.inflight = false;
            resolve(out);
          } catch (err) {
            this.inflight = false;
            console.warn('[skin-segmenter] postprocess failed:', err);
            resolve(null);
          }
        });
      } catch (err) {
        this.inflight = false;
        console.warn('[skin-segmenter] segmentForVideo threw:', err);
        resolve(null);
      }
    });
  }

  /**
   * 把 SelfieMulticlass 的 category mask 转成 RGBA mask。
   * 根据 init 探测的能力分发到 GPU 快路径或 CPU 慢路径。
   */
  private buildSkinMask(mpMask: MPMaskLike | undefined): SkinSegmentationResult | null {
    if (!mpMask) return null;
    if (this.useGpuPath && this.mpCanvas && this.drawingUtils) {
      try {
        return this.buildSkinMaskGPU(mpMask);
      } catch (e) {
        // GPU 路径失败一次后永久回落，避免每帧都抛
        console.warn('[skin-segmenter] GPU path failed, switching to CPU permanently:', e);
        this.useGpuPath = false;
      }
    }
    return this.buildSkinMaskCPU(mpMask);
  }

  /**
   * GPU 快路径：drawCategoryMask 把 categoryMask 渲染到 mpCanvas 默认 framebuffer，
   * 然后 transferToImageBitmap 切走画面生成 GPU-resident ImageBitmap。
   *
   * - 全程在 MediaPipe 的 GL context 上跑，不走 CPU
   * - transferToImageBitmap 后 mpCanvas 内容被清空（这是 spec），下次重画即可
   * - ImageBitmap 所有权移交调用方，调用方必须 close() 释放 GPU 内存
   */
  private buildSkinMaskGPU(mpMask: MPMaskLike): SkinSegmentationResult | null {
    const mpCanvas = this.mpCanvas!;
    const drawingUtils = this.drawingUtils!;

    // mpCanvas 尺寸跟 mask 走（SelfieMulticlass 固定 256×256，但代码兜住动态变化）
    if (mpCanvas.width !== mpMask.width) mpCanvas.width = mpMask.width;
    if (mpCanvas.height !== mpMask.height) mpCanvas.height = mpMask.height;

    // GPU 渲染：把 categoryMask 按 colorMap 着色到默认 framebuffer。
    // 第三个参数 background 在所有类别都被 colorMap 覆盖时不会用到，但 API 要求传。
    drawingUtils.drawCategoryMask(mpMask, SKIN_COLOR_MAP, [0, 0, 0, 255]);

    // 把当前帧切成 ImageBitmap 移交所有权。
    // 之后 mpCanvas 是空白的，但下次 draw 会重新填充。
    const bitmap = mpCanvas.transferToImageBitmap();

    return {
      mask: bitmap,
      width: mpMask.width,
      height: mpMask.height,
    };
  }

  /**
   * CPU 慢路径（fallback）：原有实现 — 走 GPU→CPU readback + LUT + putImageData。
   * 仅在 WebGL2 OffscreenCanvas 不可用 / DrawingUtils 失败时使用。
   */
  private buildSkinMaskCPU(mpMask: MPMaskLike): SkinSegmentationResult | null {
    const w = mpMask.width;
    const h = mpMask.height;

    const indices = mpMask.getAsUint8Array();
    if (!indices || indices.length !== w * h) return null;

    if (!this.maskCanvas || this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.maskCanvas = new OffscreenCanvas(w, h);
      } else {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        this.maskCanvas = c;
      }
      this.maskCtx = this.maskCanvas.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      this.maskImageData = this.maskCtx?.createImageData(w, h) ?? null;
      this.maskImageData32 = this.maskImageData
        ? new Uint32Array(this.maskImageData.data.buffer)
        : null;
    }
    if (!this.maskCtx || !this.maskImageData || !this.maskImageData32) return null;

    const dst32 = this.maskImageData32;
    const lut = SKIN_RGBA_LUT_CPU;
    const n = indices.length;
    for (let i = 0; i < n; i++) {
      dst32[i] = lut[indices[i]];
    }
    this.maskCtx.putImageData(this.maskImageData, 0, 0);

    return {
      mask: this.maskCanvas,
      width: w,
      height: h,
    };
  }

  dispose(): void {
    const segmenter = this.segmenter as { close?: () => void } | null;
    segmenter?.close?.();
    this.segmenter = null;
    this.drawingUtils?.close?.();
    this.drawingUtils = null;
    this.mpGl = null;
    this.mpCanvas = null;
    this.useGpuPath = false;
    this.maskCanvas = null;
    this.maskCtx = null;
    this.maskImageData = null;
    this.maskImageData32 = null;
  }
}

/**
 * MediaPipe MPMask 的最小接口（避免在公开类型上依赖 mediapipe types）
 */
interface MPMaskLike {
  width: number;
  height: number;
  getAsUint8Array(): Uint8Array;
  close?: () => void;
}
