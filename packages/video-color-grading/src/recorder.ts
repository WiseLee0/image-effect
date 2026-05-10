import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
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
  /** 帧率（FPS），默认 30 */
  frameRate?: number;
  /** 进度回调（0~1） */
  onProgress?: (progress: number) => void;
  /** 起始时间（秒），默认 0 */
  startTime?: number;
  /** 结束时间（秒），默认 video.duration */
  endTime?: number;
}

/**
 * 把 VideoColorGrading 处理后的视频导出为 MP4 / WebM。
 *
 * 模式：离屏逐帧 seek 渲染，与播放速度无关，能保证每一帧都被处理（导出耗时 ≈ 总帧数 × seek 延迟）。
 * 用 mediabunny 的 CanvasSource 编码，硬件加速 (WebCodecs)，零依赖。
 */
export async function exportVideo(
  processor: VideoColorGrading,
  video: HTMLVideoElement,
  opts: ExportVideoOptions = {},
): Promise<Blob> {
  const TAG = '[exportVideo]';
  const t0 = performance.now();
  const format = opts.format ?? 'mp4';
  const codec = opts.codec ?? (format === 'webm' ? 'vp9' : 'avc');
  const bitrate = opts.bitrate ?? 5_000_000;
  const frameRate = opts.frameRate ?? 30;
  const startTime = opts.startTime ?? 0;
  const endTime = opts.endTime ?? video.duration;
  const totalDuration = Math.max(0, endTime - startTime);
  const totalFrames = Math.max(1, Math.round(totalDuration * frameRate));

  console.log(`${TAG} === 开始导出 ===`, {
    format,
    codec,
    bitrate,
    frameRate,
    startTime,
    endTime,
    totalDuration,
    totalFrames,
    video: {
      currentSrc: video.currentSrc,
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      paused: video.paused,
      currentTime: video.currentTime,
      muted: video.muted,
    },
    backendType: processor.getBackendType(),
    canvasSize: processor.getSize(),
  });

  const canvas = processor.getCanvas();
  console.log(`${TAG} canvas before source`, {
    width: canvas.width,
    height: canvas.height,
    clientWidth: canvas.clientWidth,
    clientHeight: canvas.clientHeight,
  });

  let output: Output | undefined;
  let source: CanvasSource | undefined;
  try {
    output = new Output({
      format: format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    source = new CanvasSource(canvas, { codec, bitrate });
    output.addVideoTrack(source, { frameRate });
    console.log(`${TAG} output/source created, calling output.start()`);
    await output.start();
    console.log(`${TAG} output.start() resolved`);
  } catch (e) {
    console.error(`${TAG} 初始化 output/source 失败:`, e);
    throw e;
  }

  const wasPaused = video.paused;
  const previousTime = video.currentTime;
  if (!wasPaused) video.pause();

  const seekTo = (t: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = Math.min(Math.max(0, t), Math.max(0, video.duration - 1e-3));
    });

  // 仅在关键节点打印每帧详情（前 3 帧 + 每 10% + 最后 3 帧），其他帧只累计统计
  const verboseFrameSet = new Set<number>();
  for (let i = 0; i < Math.min(3, totalFrames); i++) verboseFrameSet.add(i);
  for (let i = 0; i < 10; i++) {
    const idx = Math.min(totalFrames - 1, Math.floor((i / 10) * totalFrames));
    verboseFrameSet.add(idx);
  }
  for (let i = Math.max(0, totalFrames - 3); i < totalFrames; i++) verboseFrameSet.add(i);

  let seekTotalMs = 0;
  let rvfcTotalMs = 0;
  let renderTotalMs = 0;
  let addTotalMs = 0;
  let lastFrameCanvasW = 0;
  let lastFrameCanvasH = 0;

  try {
    for (let i = 0; i < totalFrames; i++) {
      const verbose = verboseFrameSet.has(i);
      const targetTime = startTime + i / frameRate;
      const frameStart = performance.now();

      // 1) seek
      const seekStart = performance.now();
      try {
        await seekTo(targetTime);
      } catch (e) {
        console.error(`${TAG} seek 第 ${i} 帧 (t=${targetTime}) 失败:`, e);
        throw e;
      }
      const seekMs = performance.now() - seekStart;
      seekTotalMs += seekMs;

      // 2) requestVideoFrameCallback 一次以确保新帧已上屏
      const rvfcStart = performance.now();
      await new Promise<void>((resolve) => {
        type RVFCHost = HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        const host = video as RVFCHost;
        if (typeof host.requestVideoFrameCallback === 'function') {
          host.requestVideoFrameCallback(() => resolve());
        } else {
          requestAnimationFrame(() => resolve());
        }
      });
      const rvfcMs = performance.now() - rvfcStart;
      rvfcTotalMs += rvfcMs;

      // 3) renderOnce
      const renderStart = performance.now();
      try {
        processor.renderOnce();
      } catch (e) {
        console.error(`${TAG} renderOnce 第 ${i} 帧失败:`, e);
        throw e;
      }
      const renderMs = performance.now() - renderStart;
      renderTotalMs += renderMs;

      lastFrameCanvasW = canvas.width;
      lastFrameCanvasH = canvas.height;

      // 4) 编码送入 mediabunny
      const addStart = performance.now();
      try {
        await source.add(i / frameRate, 1 / frameRate);
      } catch (e) {
        console.error(`${TAG} source.add 第 ${i} 帧失败 (t=${i / frameRate}, dur=${1 / frameRate}):`, e, {
          canvasW: canvas.width,
          canvasH: canvas.height,
          videoCurrentTime: video.currentTime,
          videoReadyState: video.readyState,
        });
        throw e;
      }
      const addMs = performance.now() - addStart;
      addTotalMs += addMs;

      const frameTotalMs = performance.now() - frameStart;
      if (verbose) {
        console.log(
          `${TAG} 帧 ${i + 1}/${totalFrames} (t=${targetTime.toFixed(3)})`,
          {
            seekMs: +seekMs.toFixed(1),
            rvfcMs: +rvfcMs.toFixed(1),
            renderMs: +renderMs.toFixed(1),
            addMs: +addMs.toFixed(1),
            totalMs: +frameTotalMs.toFixed(1),
            videoCurrentTime: +video.currentTime.toFixed(3),
            canvasW: canvas.width,
            canvasH: canvas.height,
          },
        );
      }
      opts.onProgress?.((i + 1) / totalFrames);
    }

    console.log(`${TAG} 所有帧已 add，调用 output.finalize()`);
    const finalizeStart = performance.now();
    await output.finalize();
    console.log(
      `${TAG} output.finalize() resolved (${(performance.now() - finalizeStart).toFixed(1)}ms)`,
    );
  } catch (e) {
    console.error(`${TAG} 导出循环异常:`, e);
    throw e;
  } finally {
    video.currentTime = previousTime;
    if (!wasPaused) {
      video.play().catch(() => {
        /* play() 可能被浏览器策略拒绝，无视 */
      });
    }
  }

  // output.target 在 Output 的类型推断里是 Target 联合类型，但运行时一定是 BufferTarget
  const buffer = (output.target as BufferTarget).buffer;
  console.log(`${TAG} 编码完成，buffer:`, {
    hasBuffer: !!buffer,
    byteLength: buffer?.byteLength ?? 0,
    avgPerFrameMs: {
      seek: +(seekTotalMs / totalFrames).toFixed(1),
      rvfc: +(rvfcTotalMs / totalFrames).toFixed(1),
      render: +(renderTotalMs / totalFrames).toFixed(1),
      add: +(addTotalMs / totalFrames).toFixed(1),
    },
    lastFrameCanvasSize: { w: lastFrameCanvasW, h: lastFrameCanvasH },
    elapsedMs: +(performance.now() - t0).toFixed(1),
  });
  if (!buffer) throw new Error('Export failed: no buffer produced');
  const mime = format === 'webm' ? 'video/webm' : 'video/mp4';
  // BufferTarget.buffer 在 mediabunny 中类型为 ArrayBuffer，Blob 可直接接收
  const blob = new Blob([buffer], { type: mime });
  console.log(`${TAG} === 导出完成 ===`, { blobSize: blob.size, blobType: blob.type });
  return blob;
}
