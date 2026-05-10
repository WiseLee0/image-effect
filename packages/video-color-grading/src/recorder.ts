import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
  WebMOutputFormat,
} from 'mediabunny';
import type { VideoColorGrading } from './processor';

export interface ExportVideoOptions {
  /** 输出格式：'mp4' (H.264) 或 'webm' (VP9)。默认 mp4 */
  format?: 'mp4' | 'webm';
  /** 编码器：mp4 默认 'avc'，webm 默认 'vp9' */
  codec?: 'avc' | 'vp9';
  /** 视频码率（bps），默认 5_000_000 */
  bitrate?: number;
  /** 帧率（FPS）。默认按源视频实际帧率（推荐），传 0/null 也走该默认 */
  frameRate?: number;
  /** 进度回调（0~1） */
  onProgress?: (progress: number) => void;
  /** 起始时间（秒），默认 0 */
  startTime?: number;
  /** 结束时间（秒），默认 source.duration */
  endTime?: number;
}

/**
 * 视频源：可传 Blob/File、URL 字符串，或一个 HTMLVideoElement（自动从 currentSrc fetch）。
 */
export type ExportVideoSource = Blob | string | HTMLVideoElement;

/**
 * 把 VideoColorGrading 处理后的视频导出为 MP4 / WebM，并保留源视频的音轨。
 *
 * 实现：基于 mediabunny `Conversion` API。
 * - 视频走 `process` 回调：每帧 VideoSample → VideoFrame 上传到 GPU 调色 → 从内部 canvas
 *   抓取 ImageBitmap 返回，由 Conversion 编码进输出容器。
 * - 音频由 Conversion 自动从源轨道复制（codec 兼容时直通，不兼容时自动转码），无需额外处理。
 * - `trim` 控制起止时间。
 */
export async function exportVideo(
  processor: VideoColorGrading,
  source: ExportVideoSource,
  opts: ExportVideoOptions = {},
): Promise<Blob> {
  const format = opts.format ?? 'mp4';
  const codec = opts.codec ?? (format === 'webm' ? 'vp9' : 'avc');
  const bitrate = opts.bitrate ?? 5_000_000;

  // 1) 打开输入
  const input = await openInput(source);
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('Input has no video track');
  const decodable = await videoTrack.canDecode();
  if (!decodable) throw new Error('Input video codec is not decodable in this browser');

  const trackDuration = await videoTrack.computeDuration();
  const packetStats = await videoTrack.computePacketStats(60);
  const sourceFrameRate = packetStats.averagePacketRate || 30;
  const frameRate = opts.frameRate && opts.frameRate > 0 ? opts.frameRate : sourceFrameRate;
  const startTime = opts.startTime ?? 0;
  const endTime = opts.endTime ?? trackDuration;
  const codedW = await videoTrack.getCodedWidth();
  const codedH = await videoTrack.getCodedHeight();
  const dispW = await videoTrack.getDisplayWidth();
  const dispH = await videoTrack.getDisplayHeight();

  // mp4 H.264/HEVC 要求宽高为偶数；保险起见取 displayWidth/Height 并向下取偶
  const outW = makeEven(dispW || codedW);
  const outH = makeEven(dispH || codedH);

  // 2) 让 processor backend 用真实尺寸初始化（决定 canvas 大小 = 目标分辨率）
  await processor.ensureReadyForSource(outW, outH);
  const canvas = processor.getCanvas();

  // 3) 准备输出容器
  const output = new Output({
    format: format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  // 4) 配置 Conversion：视频走 process 回调注入调色，音频默认自动复制/转码
  let conversion: Conversion;
  try {
    conversion = await Conversion.init({
      input,
      output,
      trim: { start: startTime, end: endTime },
      video: {
        codec,
        bitrate,
        frameRate,
        width: outW,
        height: outH,
        fit: 'fill',
        forceTranscode: true,
        processedWidth: outW,
        processedHeight: outH,
        process: async (sample) => {
          // VideoSample → VideoFrame，上传 GPU 调色
          const frame = sample.toVideoFrame();
          try {
            processor.renderFromSource(frame);
          } finally {
            frame.close();
          }
          // 从渲染目标 canvas 拷出当前帧（避免共享 canvas 在管线缓存时被覆盖）
          return await createImageBitmap(canvas);
        },
      },
    });
  } catch (e) {
    input.dispose();
    throw e;
  }

  if (opts.onProgress) {
    let lastProgress = -1;
    conversion.onProgress = (p) => {
      const v = Math.min(1, Math.max(0, p));
      if (v - lastProgress >= 0.01 || v >= 1) {
        opts.onProgress!(v);
        lastProgress = v;
      }
    };
  }

  // 5) 执行
  try {
    await conversion.execute();
  } finally {
    input.dispose();
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('Export failed: no buffer produced');
  const mime = format === 'webm' ? 'video/webm' : 'video/mp4';
  return new Blob([buffer], { type: mime });
}

async function openInput(source: ExportVideoSource): Promise<Input> {
  if (source instanceof Blob) {
    return new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
  }
  if (typeof source === 'string') {
    return new Input({ formats: ALL_FORMATS, source: new UrlSource(source) });
  }
  // HTMLVideoElement：从 currentSrc 拉回 Blob 后用 BlobSource
  const url = source.currentSrc || source.src;
  if (!url) throw new Error('Video element has no src to export from');
  if (url.startsWith('blob:')) {
    const blob = await fetch(url).then((r) => r.blob());
    return new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  }
  return new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
}

function makeEven(n: number): number {
  return n - (n % 2);
}
