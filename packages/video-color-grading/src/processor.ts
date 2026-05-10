import {
  type BackendType,
  BaseBackend,
  type ColorGradingSettings,
  type CubeLUT,
  defaultLUTParams,
  defaultSettings,
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

export { defaultSettings };
export { parseCubeLUT };
export type { CubeLUT };
export type {
  BackendType,
  ColorGradingSettings,
  LUTParams,
  PartialColorGradingSettings,
  ProcessorOptions,
};

/**
 * 视频处理器扩展选项
 */
export interface VideoProcessorOptions extends ProcessorOptions {
  /**
   * 启用语义肤色分割（MediaPipe SelfieMulticlass，VIDEO 模式带跨帧追踪）
   * - true：构造时即异步预加载模型；start() 后渲染循环里降频跑分割
   * - false：纯像素 mask（Kovac+YCbCr）模式
   * - 自定义 Provider：用其他分割实现替换（必须是 VIDEO 模式）
   *
   * 默认 true。模型加载失败会静默回落到纯像素 mask。
   * 实际分割频率由 MediaPipe 推理速度决定（GPU ~14fps），中间帧复用上次 mask。
   */
  skinSegmentation?: boolean | SkinSegmentationProvider | SkinSegmenterOptions;
}

/**
 * 视频调色处理器
 *
 * 实时把调色 + LUT 应用到 HTMLVideoElement 的每一帧，输出到内部 canvas。
 * 通过 mediabunny 可把渲染结果编码为 MP4/WebM（见 ./recorder）。
 *
 * @example
 * ```ts
 * const proc = new VideoColorGrading();
 * await proc.attachVideo(videoEl);
 * proc.setSettings({ brightness: 20, contrast: 10 });
 * await proc.loadLUT('/luts/cinematic.cube');
 * proc.setLUTIntensity(70);
 * proc.setLUTSkinProtection(40);
 * proc.start();      // 开始按视频播放节奏渲染
 * // ...
 * proc.stop();
 * proc.dispose();
 * ```
 */
export class VideoColorGrading {
  private canvas: HTMLCanvasElement;
  private backend: BaseBackend | null = null;
  private backendType: BackendType;
  private settings: ColorGradingSettings = { ...defaultSettings };
  private lutLoaded = false;
  private lutParams: LUTParams = { ...defaultLUTParams };
  private video: HTMLVideoElement | null = null;
  private videoReady = false;
  private rafId: number | null = null;
  private rvfcId: number | null = null;
  private initPromise: Promise<void> | null = null;
  private segmenter: SkinSegmentationProvider | null = null;
  // 单调递增的 video timestamp（ms），喂给 MediaPipe segmentForVideo
  private segVideoTimestamp = 0;

  constructor(options: VideoProcessorOptions = {}) {
    this.canvas = options.canvas || document.createElement('canvas');
    this.backendType = selectBestBackend(options.backend);

    // 默认启用 MediaPipe（VIDEO 模式）；构造时立即预加载模型
    const seg = options.skinSegmentation ?? true;
    if (seg !== false) {
      if (typeof seg === 'object' && 'segmentVideo' in seg) {
        this.segmenter = seg;
      } else {
        const segOpts = typeof seg === 'object' ? seg : {};
        this.segmenter = new MediaPipeSkinSegmenter({ ...segOpts, runningMode: 'VIDEO' });
      }
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
  }

  resetSettings(): void {
    this.settings = { ...defaultSettings };
  }

  /**
   * 绑定视频元素，建立纹理资源。
   * 内部确保视频真正解码出第一帧（GPU 已有 backing resource）后再上传到纹理，
   * 避免 WebGPU copyExternalImageToTexture 因 video 无 backing resource 而抛错。
   */
  async attachVideo(video: HTMLVideoElement): Promise<void> {
    await this.ensureBackend();
    // Step 1: 等到 metadata + 至少一帧解码（HAVE_CURRENT_DATA = 2）
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('canplay', onReady);
          video.removeEventListener('error', onErr);
        };
        const onReady = () => {
          if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
            cleanup();
            resolve();
          }
        };
        const onErr = () => {
          cleanup();
          reject(new Error('Video failed to load'));
        };
        video.addEventListener('loadeddata', onReady);
        video.addEventListener('canplay', onReady);
        video.addEventListener('error', onErr);
        // 触发解码：某些浏览器需要 load() 才会开始下载/解码
        if (video.networkState === 0 /* NETWORK_EMPTY */ && video.src) video.load();
      });
    }
    // Step 2: 强制浏览器把第一帧解码上传到 GPU。
    // readyState=2 只代表"有数据"，并不保证 GPU 已分配 backing texture。
    // 显式 seek + 等 'seeked' 事件可强制 Chrome 解码并把帧投递到合成器/GPU。
    await this.ensureFirstFrameOnGPU(video);
    this.video = video;
    // Step 3: 上传到 GPU。如果首次仍失败（Chrome 偶发），等下一帧再试，最多 3 次。
    await this.tryLoadVideoToBackend(video, 3);
    if (this.lutLoaded) {
      this.backend?.setLUTParams(this.lutParams);
    }
    this.videoReady = true;
    // 立即渲染一帧，避免 canvas 一直空白
    this.renderOnce();
  }

  /**
   * 加载 LUT（接受 .cube 文本、File、URL 字符串或已解析的 CubeLUT 对象）
   */
  async loadLUT(input: string | File | CubeLUT): Promise<void> {
    await this.ensureBackend();
    let lut: CubeLUT;
    if (typeof input === 'string') {
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
  }

  clearLUT(): void {
    this.backend?.setLUT(null);
    this.lutLoaded = false;
  }

  setLUTIntensity(intensity: number): void {
    this.lutParams = { ...this.lutParams, intensity: Math.max(0, Math.min(100, intensity)) / 100 };
    this.backend?.setLUTParams(this.lutParams);
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
  }

  hasLUT(): boolean {
    return this.lutLoaded;
  }

  /**
   * 启动渲染循环：每一帧视频画面到来时上传到 GPU 并渲染。
   * 优先 video.requestVideoFrameCallback（精确到帧），否则 fallback 到 rAF。
   *
   * 同时启动语义分割：每帧尝试调用 MediaPipe；inflight 标志保证最多一个分割在跑，
   * 实际频率由 GPU 推理速度决定（~14fps），中间帧自动复用上一次 mask。
   */
  start(): void {
    if (!this.video || !this.backend || !this.videoReady) {
      console.warn('VideoColorGrading.start: attachVideo first');
      return;
    }
    this.stop();

    const video = this.video;
    type RVFCHost = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const host = video as RVFCHost;
    const useRVFC = typeof host.requestVideoFrameCallback === 'function';

    if (useRVFC) {
      const tick = () => {
        if (!this.video || !this.backend) return;
        try {
          this.backend.updateFromVideo(this.video);
          this.tryRunSegmentation(this.video);
          this.backend.render(this.settings);
        } catch (e) {
          console.error('Render error:', e);
        }
        const h = this.video as RVFCHost;
        this.rvfcId = h.requestVideoFrameCallback!(tick);
      };
      this.rvfcId = host.requestVideoFrameCallback!(tick);
    } else {
      const loop = () => {
        if (!this.video || !this.backend) return;
        try {
          this.backend.updateFromVideo(this.video);
          this.tryRunSegmentation(this.video);
          this.backend.render(this.settings);
        } catch (e) {
          console.error('Render error:', e);
        }
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
  }

  /**
   * 尝试对当前视频帧跑分割（异步）。如已有分割在进行（segmenter 内部 inflight），
   * 本帧自然丢弃；完成后异步把 mask 喂给 backend，下一帧渲染时即生效。
   *
   * 短路条件（直接 return，零开销）：
   *   - skinProtection<=0：用户没开肤色保护，分割结果不会影响渲染
   *
   * 开启肤色保护时每帧都触发，由 segmenter 内部 inflight 标志控制并发，
   * 实际推理频率由 GPU 速度决定（~14fps），中间帧丢弃并复用上次 mask。
   */
  private tryRunSegmentation(video: HTMLVideoElement): void {
    if (!this.segmenter) return;
    if (this.settings.skinProtection <= 0) return;
    // 视频可能在播放/暂停/seek 切换状态，必须有解码帧才能喂给 MediaPipe
    if (video.readyState < 2) return;
    const ts = ++this.segVideoTimestamp;
    void (async () => {
      try {
        const result = await this.segmenter!.segmentVideo(video, ts);
        if (!result || !this.backend || !this.video) {
          // 视频已被换源或 backend 销毁：result 是 ImageBitmap 时仍要释放
          if (result?.mask instanceof ImageBitmap) result.mask.close();
          return;
        }
        // 视频已被 detach 或换源，丢弃旧结果
        if (this.video !== video) {
          if (result.mask instanceof ImageBitmap) result.mask.close();
          return;
        }
        this.backend.setSkinSegmentationMask(result.mask);
        // backend 上传是同步的，上传完后 ImageBitmap 已不再被引用，立即释放 GPU 内存
        if (result.mask instanceof ImageBitmap) result.mask.close();
      } catch {
        // 静默失败，shader 内回落到像素 mask
      }
    })();
  }

  stop(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.rvfcId != null && this.video) {
      type RVFCHost = HTMLVideoElement & {
        cancelVideoFrameCallback?: (id: number) => void;
      };
      const host = this.video as RVFCHost;
      host.cancelVideoFrameCallback?.(this.rvfcId);
      this.rvfcId = null;
    }
  }

  /**
   * 同步渲染当前视频帧一次。导出/seek 场景使用。
   */
  renderOnce(): void {
    if (!this.video || !this.backend || !this.videoReady) return;
    try {
      this.backend.updateFromVideo(this.video);
      this.tryRunSegmentation(this.video);
      this.backend.render(this.settings);
    } catch (e) {
      console.warn('renderOnce skipped:', e);
    }
  }

  getSize(): { width: number; height: number } {
    return this.backend?.getSize() ?? { width: 0, height: 0 };
  }

  dispose(): void {
    this.stop();
    if (this.backend) {
      this.backend.dispose();
      this.backend = null;
    }
    this.segmenter?.dispose();
    this.segmenter = null;
    this.video = null;
    this.videoReady = false;
    this.lutLoaded = false;
    this.initPromise = null;
  }

  private async initBackend(): Promise<void> {
    if (this.backend) return;

    if (this.backendType === 'webgpu') {
      this.backend = new WebGPUBackend(this.canvas);
      try {
        await this.backend.init();
      } catch (e) {
        console.warn('WebGPU initialization failed, falling back to WebGL:', e);
        this.backend = new WebGLBackend(this.canvas);
        this.backend.init();
        this.backendType = 'webgl';
      }
    } else {
      this.backend = new WebGLBackend(this.canvas);
      this.backend.init();
    }
  }

  /**
   * 调用 backend.loadFromVideo，如失败则等下一帧重试，最多 attempts 次。
   * Chrome 偶发：seek 完成但 GPU 合成器还没拿到帧。
   */
  private async tryLoadVideoToBackend(video: HTMLVideoElement, attempts: number): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        this.backend?.loadFromVideo(video);
        return;
      } catch (e) {
        lastErr = e;
        // 等一帧再重试
        await new Promise<void>((resolve) => {
          type RVFCHost = HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
          };
          const host = video as RVFCHost;
          if (typeof host.requestVideoFrameCallback === 'function') {
            let done = false;
            host.requestVideoFrameCallback!(() => {
              if (done) return;
              done = true;
              resolve();
            });
            setTimeout(() => {
              if (done) return;
              done = true;
              resolve();
            }, 200);
          } else {
            setTimeout(resolve, 100);
          }
        });
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Failed to upload video to GPU after ${attempts} attempts`);
  }

  private async ensureBackend(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initBackend();
    }
    await this.initPromise;
  }

  /**
   * 确保 video 的第一帧已经解码并上传到 GPU 合成器层。
   * Chrome 在 video 元素从未参与渲染（display:none、未播放、未 seek）时,
   * 即使 readyState=4 也可能没有 GPU backing texture, 导致
   * WebGPU copyExternalImageToTexture 抛 "external image without back resource"。
   * 解决：play→pause 触发 GPU 解码会话建立 + seek + RVFC 三重保险。
   */
  private async ensureFirstFrameOnGPU(video: HTMLVideoElement): Promise<void> {
    // 1. play→pause 强制 Chrome 建立 GPU 解码会话和合成器层。
    //    muted 视频不受自动播放策略限制。
    const wasPaused = video.paused;
    try {
      await video.play();
      if (wasPaused) video.pause();
    } catch {
      // 忽略：自动播放被拒绝时仍尝试后续步骤
    }

    // 2. 强制 seek 触发解码 + GPU 上传
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      try {
        // 同位置 seek 不会触发 seeked，所以微调一下；接近 0 但非 0
        const target = video.currentTime > 0.001 ? video.currentTime : 0.001;
        video.currentTime = target;
      } catch {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }
      // 安全网：800ms 内若无 seeked 事件，强行继续
      setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, 800);
    });

    // 3. 用 requestVideoFrameCallback 再等一次，确保帧已在合成器队列里
    type RVFCHost = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const host = video as RVFCHost;
    if (typeof host.requestVideoFrameCallback === 'function') {
      await new Promise<void>((resolve) => {
        let done = false;
        host.requestVideoFrameCallback!(() => {
          if (done) return;
          done = true;
          resolve();
        });
        setTimeout(() => {
          if (done) return;
          done = true;
          resolve();
        }, 500);
      });
    }
  }
}
