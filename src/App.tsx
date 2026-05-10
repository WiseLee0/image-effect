import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ChangeEvent,
} from "react";
import "./App.css";
import imageUrl from "./image.png";
import videoUrl from "./video.mp4";
import defaultLUTUrl from "./06_Classic_BW.cube?url";
import {
  ImageColorGrading,
  defaultSettings,
  type ColorGradingSettings,
  type BackendType,
} from "image-color-grading";
import {
  VideoColorGrading,
  exportVideo,
} from "video-color-grading";

type BackendChoice = "auto" | BackendType;
type TabKey = "image" | "video";

const DEFAULT_LUT_NAME = "06_Classic_BW.cube";

const App = () => {
  const [tab, setTab] = useState<TabKey>("video");

  return (
    <div className="page">
      <div className="page__tabs">
        <button
          className={`page__tab${tab === "image" ? " page__tab--active" : ""}`}
          onClick={() => setTab("image")}
        >
          图片调色
        </button>
        <button
          className={`page__tab${tab === "video" ? " page__tab--active" : ""}`}
          onClick={() => setTab("video")}
        >
          视频调色
        </button>
      </div>
      <div className="page__main">{tab === "image" ? <ImageTab /> : <VideoTab />}</div>
    </div>
  );
};

// =====================  图片 Tab  =====================

const ImageTab = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const processorRef = useRef<ImageColorGrading | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lutInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const settingsRef = useRef<ColorGradingSettings>(defaultSettings);
  const lutIntensityRef = useRef(100);
  const shouldLoadDefaultLUTRef = useRef(true);
  const [imageSrc, setImageSrc] = useState(imageUrl);
  const [settings, setSettings] = useState<ColorGradingSettings>(defaultSettings);
  const [backendType, setBackendType] = useState<BackendType | null>(null);
  const [backendChoice, setBackendChoice] = useState<BackendChoice>("auto");
  const [lutName, setLutName] = useState<string | null>(DEFAULT_LUT_NAME);
  const [lutIntensity, setLutIntensity] = useState(100);
  const [lutSkin, setLutSkin] = useState(0);
  const isWebGPUSupported = ImageColorGrading.isWebGPUSupported();
  const isWebGLSupported = ImageColorGrading.isWebGLSupported();

  useEffect(() => {
    const processor = new ImageColorGrading({ backend: backendChoice });
    processorRef.current = processor;
    if (containerRef.current) {
      const canvas = processor.getCanvas();
      canvas.className = "stage__canvas";
      containerRef.current.replaceChildren(canvas);
    }
    setBackendType(null);
    setLutName(DEFAULT_LUT_NAME);
    shouldLoadDefaultLUTRef.current = true;

    return () => {
      processor.dispose();
    };
  }, [backendChoice]);

  useEffect(() => {
    const processor = processorRef.current;
    if (!processor) return;
    let cancelled = false;
    processor
      .loadImage(imageSrc)
      .then(() => {
        if (cancelled) return;
        setBackendType(processor.getBackendType());
        processor.setSettings(settingsRef.current);
        // 默认 LUT 必须在 loadImage 之后加载（WebGL backend 依赖 image resources）
        if (shouldLoadDefaultLUTRef.current) {
          shouldLoadDefaultLUTRef.current = false;
          processor
            .loadLUT(defaultLUTUrl)
            .then(() => {
              if (cancelled) return;
              processor.setLUTIntensity(lutIntensityRef.current);
            })
            .catch(() => {
              if (cancelled) return;
              setLutName(null);
            });
        }
      })
      .catch(() => {
        /* 图像加载失败，静默处理 */
      });
    return () => {
      cancelled = true;
    };
  }, [imageSrc, backendChoice]);

  useEffect(() => {
    settingsRef.current = settings;
    const processor = processorRef.current;
    if (!processor || !processor.isLoaded()) return;
    processor.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const updateSetting =
    (key: keyof ColorGradingSettings) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = Number(event.target.value);
        setSettings((prev) => ({ ...prev, [key]: value }));
      };

  const handleReplaceImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = nextUrl;
    setImageSrc(nextUrl);
    event.target.value = "";
  };

  const handleExport = async () => {
    const processor = processorRef.current;
    if (!processor) return;
    const blob = await processor.toBlob({ format: "image/png" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "edited-image.png";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAutoFix = useCallback(() => {
    const processor = processorRef.current;
    if (!processor || !processor.isLoaded()) return;
    setSettings(processor.autoFix());
  }, []);

  const presetClick = (name: "blackAndWhite" | "pop" | "vintage" | "vivid" | "cinematic") => () => {
    const processor = processorRef.current;
    if (!processor) return;
    setSettings(processor.applyPreset(name));
  };

  const handleLUTPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const processor = processorRef.current;
    if (!processor) return;
    try {
      await processor.loadLUT(file);
      processor.setLUTIntensity(lutIntensity);
      setLutName(file.name);
      shouldLoadDefaultLUTRef.current = false;
    } catch (e) {
      alert(`LUT 解析失败: ${(e as Error).message}`);
    }
    event.target.value = "";
  };

  const handleLUTClear = () => {
    processorRef.current?.clearLUT();
    setLutName(null);
    shouldLoadDefaultLUTRef.current = false;
  };

  const handleLUTIntensity = (event: ChangeEvent<HTMLInputElement>) => {
    const v = Number(event.target.value);
    setLutIntensity(v);
    lutIntensityRef.current = v;
    processorRef.current?.setLUTIntensity(v);
  };

  const handleLUTSkin = (event: ChangeEvent<HTMLInputElement>) => {
    const v = Number(event.target.value);
    setLutSkin(v);
    setSettings((prev) => ({ ...prev, skinProtection: v }));
  };

  return (
    <>
      <div className="panel">
        <div className="reset-button">
          <div className="reset-button__row">
            <button className="panel__reset" onClick={handleAutoFix}>自动</button>
            <button className="panel__reset" onClick={presetClick("blackAndWhite")}>黑白风格</button>
            <button className="panel__reset" onClick={presetClick("pop")}>流行风格</button>
            <button className="panel__reset" onClick={presetClick("vintage")}>复古风格</button>
            <button className="panel__reset" onClick={presetClick("vivid")}>鲜艳风格</button>
            <button className="panel__reset" onClick={presetClick("cinematic")}>电影风格</button>
          </div>
          <div className="reset-button__divider" />
          <div className="reset-button__row reset-button__row--secondary">
            <button className="panel__reset" onClick={() => setSettings(defaultSettings)}>重置</button>
            <label className="reset-button__backend">
              <span>切换后端</span>
              <select
                className="reset-button__select"
                value={backendChoice}
                onChange={(e) => setBackendChoice(e.target.value as BackendChoice)}
              >
                <option value="auto">自动</option>
                <option value="webgl" disabled={!isWebGLSupported}>WebGL</option>
                <option value="webgpu" disabled={!isWebGPUSupported}>WebGPU</option>
              </select>
            </label>
          </div>
        </div>
        <div className="panel__content">
          <LUTPanel
            lutName={lutName}
            intensity={lutIntensity}
            skin={lutSkin}
            onPick={() => lutInputRef.current?.click()}
            onClear={handleLUTClear}
            onIntensity={handleLUTIntensity}
            onSkin={handleLUTSkin}
          />
          <ColorPanel settings={settings} updateSetting={updateSetting} />
          <input
            ref={lutInputRef}
            className="stage__file"
            type="file"
            accept=".cube"
            onChange={handleLUTPick}
          />
        </div>
      </div>

      <div className="stage">
        <div className="stage__frame" ref={containerRef} />
        {backendType && (
          <div className="stage__backend">
            渲染后端: <span className="stage__backend-type">{backendType.toUpperCase()}</span>
          </div>
        )}
        <div className="stage__actions">
          <input
            ref={fileInputRef}
            className="stage__file"
            type="file"
            accept="image/*"
            onChange={handleReplaceImage}
          />
          <button className="stage__action" onClick={() => fileInputRef.current?.click()}>替换图片</button>
          <button className="stage__action" onClick={handleExport}>导出图片</button>
        </div>
      </div>
    </>
  );
};

// =====================  视频 Tab  =====================

const VideoTab = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const processorRef = useRef<VideoColorGrading | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const lutInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const settingsRef = useRef<ColorGradingSettings>(defaultSettings);
  const lutIntensityRef = useRef(100);
  const shouldLoadDefaultLUTRef = useRef(true);

  const [settings, setSettings] = useState<ColorGradingSettings>(defaultSettings);
  const [backendType, setBackendType] = useState<BackendType | null>(null);
  const [backendChoice, setBackendChoice] = useState<BackendChoice>("auto");
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [lutName, setLutName] = useState<string | null>(DEFAULT_LUT_NAME);
  const [lutIntensity, setLutIntensity] = useState(100);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const isWebGPUSupported = VideoColorGrading.isWebGPUSupported();
  const isWebGLSupported = VideoColorGrading.isWebGLSupported();

  // 初始化 processor + video element
  useEffect(() => {
    const processor = new VideoColorGrading({
      backend: backendChoice,
    });
    processorRef.current = processor;
    (window as unknown as { __videoProcessor?: VideoColorGrading }).__videoProcessor = processor;
    if (containerRef.current) {
      const canvas = processor.getCanvas();
      canvas.className = "stage__canvas";
      // 创建一个视觉隐藏但仍参与渲染的 <video> 用作源
      // 注意：不能用 display:none / visibility:hidden，否则 Chrome 会跳过 GPU 解码，
      // 导致 WebGPU copyExternalImageToTexture 找不到 video 的 backing resource。
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true; // 自动播放需要静音
      video.loop = true;
      video.playsInline = true;
      video.style.position = "absolute";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.style.left = "0";
      video.style.top = "0";
      videoRef.current = video;
      containerRef.current.replaceChildren(canvas, video);
    }
    setBackendType(null);
    setVideoLoaded(false);
    setLutName(DEFAULT_LUT_NAME);
    shouldLoadDefaultLUTRef.current = true;

    // 默认加载演示视频
    let cancelled = false;
    (async () => {
      const video = videoRef.current;
      if (!video) return;
      video.src = videoUrl;
      try {
        await new Promise<void>((resolve, reject) => {
          const onMeta = () => {
            video.removeEventListener("loadedmetadata", onMeta);
            video.removeEventListener("error", onErr);
            resolve();
          };
          const onErr = () => {
            video.removeEventListener("loadedmetadata", onMeta);
            video.removeEventListener("error", onErr);
            reject(new Error("Failed to load default video"));
          };
          video.addEventListener("loadedmetadata", onMeta);
          video.addEventListener("error", onErr);
        });
        if (cancelled) return;
        await processor.attachVideo(video);
        if (cancelled) return;
        processor.setSettings(settingsRef.current);
        setBackendType(processor.getBackendType());
        setVideoLoaded(true);
        // attachVideo 完成后再加载默认 LUT（WebGL backend 依赖 video resources）
        if (shouldLoadDefaultLUTRef.current) {
          shouldLoadDefaultLUTRef.current = false;
          try {
            await processor.loadLUT(defaultLUTUrl);
            if (cancelled) return;
            processor.setLUTIntensity(lutIntensityRef.current);
          } catch {
            if (!cancelled) {
              setLutName(null);
            }
          }
        }
        processor.start();
        await video.play().catch(() => {
          /* 浏览器自动播放策略可能拒绝；忽略 */
        });
      } catch {
        /* 默认视频加载失败，静默处理 */
      }
    })();

    return () => {
      cancelled = true;
      processor.dispose();
      if (videoRef.current) {
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [backendChoice]);

  // 设置变化 → 同步到 processor 并 renderOnce（暂停时也能预览）
  useEffect(() => {
    settingsRef.current = settings;
    const processor = processorRef.current;
    if (!processor) return;
    processor.setSettings(settings);
    if (videoRef.current?.paused) processor.renderOnce();
  }, [settings]);

  const handlePickVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const processor = processorRef.current;
    const video = videoRef.current;
    if (!processor || !video) return;

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    video.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        const onMeta = () => {
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onErr);
          resolve();
        };
        const onErr = () => {
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onErr);
          reject(new Error("Failed to load video"));
        };
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("error", onErr);
      });
      await processor.attachVideo(video);
      processor.setSettings(settingsRef.current);
      setBackendType(processor.getBackendType());
      setVideoLoaded(true);
      processor.start();
      await video.play().catch(() => {
        /* 用户尚未交互时浏览器可能拒绝；先保留 attach */
      });
    } catch (e) {
      alert(`视频加载失败: ${(e as Error).message}`);
    }
    event.target.value = "";
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  };

  const handleLUTPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const processor = processorRef.current;
    if (!processor) return;
    try {
      await processor.loadLUT(file);
      processor.setLUTIntensity(lutIntensity);
      setLutName(file.name);
      shouldLoadDefaultLUTRef.current = false;
      if (videoRef.current?.paused) processor.renderOnce();
    } catch (e) {
      alert(`LUT 解析失败: ${(e as Error).message}`);
    }
    event.target.value = "";
  };

  const handleLUTClear = () => {
    processorRef.current?.clearLUT();
    setLutName(null);
    shouldLoadDefaultLUTRef.current = false;
    if (videoRef.current?.paused) processorRef.current?.renderOnce();
  };

  const handleLUTIntensity = (event: ChangeEvent<HTMLInputElement>) => {
    const v = Number(event.target.value);
    setLutIntensity(v);
    lutIntensityRef.current = v;
    processorRef.current?.setLUTIntensity(v);
    if (videoRef.current?.paused) processorRef.current?.renderOnce();
  };

  const handleExport = async () => {
    const processor = processorRef.current;
    const video = videoRef.current;
    if (!processor || !video || !videoLoaded) {
      return;
    }

    setExporting(true);
    setExportProgress(0);
    try {
      const blob = await exportVideo(processor, video, {
        format: "mp4",
        codec: "avc",
        bitrate: 5_000_000,
        frameRate: 30,
        onProgress: (p) => setExportProgress(p),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "edited-video.mp4";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const err = e as Error;
      alert(`导出失败: ${err.message}`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const updateSetting =
    (key: keyof ColorGradingSettings) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = Number(event.target.value);
        setSettings((prev) => ({ ...prev, [key]: value }));
      };

  return (
    <>
      <div className="panel">
        <div className="reset-button">
          <div className="reset-button__row">
            <button className="panel__reset" onClick={() => setSettings(defaultSettings)}>重置</button>
            <button className="panel__reset" onClick={handlePlayPause} disabled={!videoLoaded}>播放 / 暂停</button>
          </div>
          <div className="reset-button__divider" />
          <div className="reset-button__row reset-button__row--secondary">
            <label className="reset-button__backend">
              <span>切换后端</span>
              <select
                className="reset-button__select"
                value={backendChoice}
                onChange={(e) => setBackendChoice(e.target.value as BackendChoice)}
              >
                <option value="auto">自动</option>
                <option value="webgl" disabled={!isWebGLSupported}>WebGL</option>
                <option value="webgpu" disabled={!isWebGPUSupported}>WebGPU</option>
              </select>
            </label>
          </div>
        </div>
        <div className="panel__content">
          <LUTPanel
            lutName={lutName}
            intensity={lutIntensity}
            onPick={() => lutInputRef.current?.click()}
            onClear={handleLUTClear}
            onIntensity={handleLUTIntensity}
          />
          <ColorPanel settings={settings} updateSetting={updateSetting} />
          <input
            ref={lutInputRef}
            className="stage__file"
            type="file"
            accept=".cube"
            onChange={handleLUTPick}
          />
        </div>
      </div>

      <div className="stage">
        <div className="stage__frame" ref={containerRef} />
        {backendType && (
          <div className="stage__backend">
            渲染后端: <span className="stage__backend-type">{backendType.toUpperCase()}</span>
          </div>
        )}
        {exporting && (
          <div className="stage__hint">导出中… {(exportProgress * 100).toFixed(0)}%</div>
        )}
        <div className="stage__actions">
          <input
            ref={videoFileInputRef}
            className="stage__file"
            type="file"
            accept="video/*"
            onChange={handlePickVideo}
          />
          <button className="stage__action" onClick={() => videoFileInputRef.current?.click()}>选择视频</button>
          <button
            className="stage__action"
            onClick={handleExport}
            disabled={!videoLoaded || exporting}
          >
            {exporting ? `导出中 ${(exportProgress * 100).toFixed(0)}%` : "导出视频"}
          </button>
        </div>
      </div>
    </>
  );
};

// =====================  通用调色面板  =====================

const ColorPanel = ({
  settings,
  updateSetting,
}: {
  settings: ColorGradingSettings;
  updateSetting: (key: keyof ColorGradingSettings) => (e: ChangeEvent<HTMLInputElement>) => void;
}) => (
  <>
    <div className="panel__group">
      <span className="panel__group-label">颜色</span>
      <Slider label="自然饱和度" value={settings.vibrance} min={-100} max={100} onChange={updateSetting("vibrance")} />
      <Slider label="饱和度" value={settings.saturation} min={-100} max={100} onChange={updateSetting("saturation")} />
      <Slider label="温度" value={settings.temperature} min={-100} max={100} onChange={updateSetting("temperature")} />
      <Slider label="色调" value={settings.tint} min={-100} max={100} onChange={updateSetting("tint")} />
      <Slider label="色相" value={settings.hue} min={-100} max={100} onChange={updateSetting("hue")} />
    </div>
    <div className="panel__group">
      <span className="panel__group-label">光亮</span>
      <Slider label="亮度" value={settings.brightness} min={-100} max={100} onChange={updateSetting("brightness")} />
      <Slider label="曝光度" value={settings.exposure} min={-100} max={100} onChange={updateSetting("exposure")} />
      <Slider label="对比度" value={settings.contrast} min={-100} max={100} onChange={updateSetting("contrast")} />
      <Slider label="黑色" value={settings.blacks} min={-100} max={100} onChange={updateSetting("blacks")} />
      <Slider label="白色" value={settings.whites} min={-100} max={100} onChange={updateSetting("whites")} />
      <Slider label="高光" value={settings.highlights} min={-100} max={100} onChange={updateSetting("highlights")} />
      <Slider label="暗调" value={settings.shadows} min={-100} max={100} onChange={updateSetting("shadows")} />
    </div>
    <div className="panel__group">
      <span className="panel__group-label">细节</span>
      <Slider label="锐化" value={settings.sharpen} min={0} max={100} onChange={updateSetting("sharpen")} />
      <Slider label="清晰度" value={settings.clarity} min={-100} max={100} onChange={updateSetting("clarity")} />
      <Slider label="平滑" value={settings.smooth} min={0} max={100} onChange={updateSetting("smooth")} />
      <Slider label="模糊" value={settings.blur} min={0} max={100} onChange={updateSetting("blur")} />
      <Slider label="颗粒" value={settings.grain} min={0} max={100} onChange={updateSetting("grain")} />
    </div>
    <div className="panel__group">
      <span className="panel__group-label">场景</span>
      <Slider label="暗角" value={settings.vignette} min={-100} max={100} onChange={updateSetting("vignette")} />
      <Slider label="氛围美化" value={settings.glamour} min={0} max={100} onChange={updateSetting("glamour")} />
      <Slider label="泛光" value={settings.bloom} min={0} max={100} onChange={updateSetting("bloom")} />
      <Slider label="除雾化" value={settings.dehaze} min={0} max={100} onChange={updateSetting("dehaze")} />
    </div>
  </>
);

// =====================  LUT 面板  =====================

const LUTPanel = ({
  lutName,
  intensity,
  skin,
  onPick,
  onClear,
  onIntensity,
  onSkin,
}: {
  lutName: string | null;
  intensity: number;
  skin?: number;
  onPick: () => void;
  onClear: () => void;
  onIntensity: (e: ChangeEvent<HTMLInputElement>) => void;
  onSkin?: (e: ChangeEvent<HTMLInputElement>) => void;
}) => (
  <div className="panel__group">
    <span className="panel__group-label">LUT 滤镜</span>
    <div className="lut-row">
      <button className="panel__reset" onClick={onPick}>导入 .cube</button>
      <button className="panel__reset" onClick={onClear} disabled={!lutName}>清除</button>
    </div>
    {lutName && <div className="lut-name">已加载：{lutName}</div>}
    <Slider label="LUT 强度" value={intensity} min={0} max={100} onChange={onIntensity} />
    {onSkin && (
      <Slider label="肤色保护" value={skin ?? 0} min={0} max={100} onChange={onSkin} />
    )}
  </div>
);

// =====================  滑块  =====================

const Slider = ({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) => {
  return (
    <label className="slider">
      <div className="slider__row">
        <span>{label}</span>
        <span className="slider__value">{value}</span>
      </div>
      <input
        className="slider__input"
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={onChange}
      />
    </label>
  );
};

export default App;
