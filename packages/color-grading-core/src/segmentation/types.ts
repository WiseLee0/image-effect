/**
 * 语义分割接口与类型
 */

/**
 * 可用作分割输入的源
 *
 * MediaPipe ImageSegmenter.segment() 接受这些 ImageSource 类型。
 */
export type SkinSegmentationSource =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap
  | OffscreenCanvas
  | ImageData;

/**
 * 分割结果：一张灰度 mask
 *
 * - 宽高与输入源一致（已上采样还原到原图分辨率）
 * - R 通道：1.0 = 皮肤，0.0 = 非皮肤；G/B/A 通道无意义
 * - 后端可直接 texImage2D / copyExternalImageToTexture 上传为纹理
 *
 * GPU 快路径下 mask 是 ImageBitmap（GPU-resident，跨 context 上传零拷贝）。
 * 此时 ImageBitmap 由分割器创建，所有权移交给调用方：
 * 用完后必须调用 mask.close()，否则会持续占用 GPU 内存。
 * CPU 慢路径回落时 mask 是 OffscreenCanvas/HTMLCanvasElement，无需手动释放。
 */
export interface SkinSegmentationResult {
  /** mask 灰度图，可被 backend 直接上纹理。ImageBitmap 时调用方负责 close */
  mask: HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
  /** mask 宽度 */
  width: number;
  /** mask 高度 */
  height: number;
}

/**
 * 分割器接口
 *
 * 实现该接口即可接入任意分割引擎（MediaPipe、ONNX、自定义模型）。
 * 默认实现：MediaPipeSkinSegmenter（@mediapipe/tasks-vision）。
 */
export interface SkinSegmentationProvider {
  /**
   * 异步初始化（下载模型、创建 GPU runtime）
   * 必须在第一次 segment 之前完成。多次调用应是幂等的。
   */
  init(): Promise<void>;

  /**
   * 是否已经初始化完成
   */
  isReady(): boolean;

  /**
   * 对一张图做分割（IMAGE 模式）
   *
   * - 返回 null 表示降级（模型未就绪/失败），调用方应当回落到纯像素 mask
   * - 失败不应 throw，必须静默返回 null（保证 LUT pipeline 不被分割问题打断）
   */
  segment(source: SkinSegmentationSource): Promise<SkinSegmentationResult | null>;

  /**
   * 对视频帧做分割（VIDEO 模式，带跨帧追踪优化）
   *
   * - timestampMs 必须严格单调递增（用 performance.now() 即可）
   * - 仅在 runningMode='VIDEO' 时可用；IMAGE 模式调用应静默返回 null
   * - 同样必须静默失败
   */
  segmentVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): Promise<SkinSegmentationResult | null>;

  /**
   * 释放资源
   */
  dispose(): void;
}

/**
 * MediaPipe 分割器选项
 */
export interface SkinSegmenterOptions {
  /**
   * tflite 模型 URL
   * 默认：SelfieMulticlass 256×256（face-skin + body-skin 直接输出，剪映同款思路）
   */
  modelAssetPath?: string;

  /**
   * MediaPipe wasm 资源根路径
   * 默认从 jsdelivr CDN 加载，对应已安装的 @mediapipe/tasks-vision 版本
   */
  wasmFileset?: string;

  /**
   * 推理时使用 GPU（WebGL）还是 CPU
   * 默认 GPU（10× 性能）
   */
  delegate?: 'CPU' | 'GPU';

  /**
   * 运行模式：
   * - 'IMAGE'：单张图，每次调用独立推理（默认，适合 image-color-grading）
   * - 'VIDEO'：视频帧序列，启用跨帧追踪优化，timestamp 必须单调递增
   *
   * 默认 'IMAGE'。VIDEO 模式只能调用 segmentVideo，IMAGE 模式只能调用 segment。
   */
  runningMode?: 'IMAGE' | 'VIDEO';
}
