import { useEffect, useRef, useState, useCallback, type ChangeEvent } from "react";
import "./App.css";
import imageUrl from "./image.jpg";
import {
  ImageColorGrading,
  defaultSettings,
  type ColorGradingSettings,
  type BackendType,
} from "image-color-grading";

type BackendChoice = "auto" | BackendType;

const App = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const processorRef = useRef<ImageColorGrading | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const settingsRef = useRef<ColorGradingSettings>(defaultSettings);
  const [imageSrc, setImageSrc] = useState(imageUrl);
  const [settings, setSettings] = useState<ColorGradingSettings>(defaultSettings);
  const [backendType, setBackendType] = useState<BackendType | null>(null);
  const [backendChoice, setBackendChoice] = useState<BackendChoice>("auto");
  const isWebGPUSupported = ImageColorGrading.isWebGPUSupported();
  const isWebGLSupported = ImageColorGrading.isWebGLSupported();

  // 初始化处理器
  useEffect(() => {
    const processor = new ImageColorGrading({ backend: backendChoice });
    processorRef.current = processor;

    // 将 canvas 添加到 DOM
    if (containerRef.current) {
      const canvas = processor.getCanvas();
      canvas.className = "stage__canvas";
      containerRef.current.replaceChildren(canvas);
    }
    setBackendType(null);

    return () => {
      processor.dispose();
    };
  }, [backendChoice]);

  // 加载图像
  useEffect(() => {
    const processor = processorRef.current;
    if (!processor) return;

    processor.loadImage(imageSrc).then(() => {
      // 图像加载后获取后端类型
      setBackendType(processor.getBackendType());
      processor.setSettings(settingsRef.current);
    }).catch((err: Error) => {
      console.error("Failed to load image:", err);
    });
  }, [imageSrc, backendChoice]);

  // 更新设置
  useEffect(() => {
    settingsRef.current = settings;
    const processor = processorRef.current;
    if (!processor || !processor.isLoaded()) return;

    processor.setSettings(settings);
  }, [settings]);

  // 清理 objectUrl
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
        setSettings((prev: ColorGradingSettings) => ({ ...prev, [key]: value }));
      };

  const handleReplaceImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
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

  // 自动修复：分析图像并自动调整色阶和鲜艳度
  const handleAutoFix = useCallback(() => {
    const processor = processorRef.current;
    if (!processor || !processor.isLoaded()) return;

    const newSettings = processor.autoFix();
    setSettings(newSettings);
  }, []);

  // 黑白效果
  const handleBlackWhite = useCallback(() => {
    const processor = processorRef.current;
    if (!processor) return;

    const newSettings = processor.applyPreset('blackAndWhite');
    setSettings(newSettings);
  }, []);

  // 流行效果
  const handlePop = useCallback(() => {
    const processor = processorRef.current;
    if (!processor) return;

    const newSettings = processor.applyPreset('pop');
    setSettings(newSettings);
  }, []);

  // 复古效果
  const handleVintage = useCallback(() => {
    const processor = processorRef.current;
    if (!processor) return;

    const newSettings = processor.applyPreset('vintage');
    setSettings(newSettings);
  }, []);

  // 鲜艳效果
  const handleVivid = useCallback(() => {
    const processor = processorRef.current;
    if (!processor) return;

    const newSettings = processor.applyPreset('vivid');
    setSettings(newSettings);
  }, []);

  // 电影效果
  const handleCinematic = useCallback(() => {
    const processor = processorRef.current;
    if (!processor) return;

    const newSettings = processor.applyPreset('cinematic');
    setSettings(newSettings);
  }, []);

  const handleBackendChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setBackendChoice(event.target.value as BackendChoice);
  };

  return (
    <div className="page">
      <div className="panel">
        <div className="reset-button">
          <div className="reset-button__row">
            <button
              className="panel__reset"
              onClick={handleAutoFix}
            >
              自动
            </button>
            <button
              className="panel__reset"
              onClick={handleBlackWhite}
            >
              黑白风格
            </button>
            <button
              className="panel__reset"
              onClick={handlePop}
            >
              流行风格
            </button>
            <button
              className="panel__reset"
              onClick={handleVintage}
            >
              复古风格
            </button>
            <button
              className="panel__reset"
              onClick={handleVivid}
            >
              鲜艳风格
            </button>
            <button
              className="panel__reset"
              onClick={handleCinematic}
            >
              电影风格
            </button>
          </div>
          <div className="reset-button__divider" />
          <div className="reset-button__row reset-button__row--secondary">
            <button
              className="panel__reset"
              onClick={() => setSettings(defaultSettings)}
            >
              重置
            </button>
            <label className="reset-button__backend">
              <span>切换后端</span>
              <select
                className="reset-button__select"
                value={backendChoice}
                onChange={handleBackendChange}
              >
                <option value="auto">自动</option>
                <option value="webgl" disabled={!isWebGLSupported}>WebGL</option>
                <option value="webgpu" disabled={!isWebGPUSupported}>WebGPU</option>
              </select>
            </label>
          </div>
        </div>
        <div className="panel__content">
          <div className="panel__group">
            <span className="panel__group-label">颜色</span>
            <Slider
              label="自然饱和度"
              value={settings.vibrance}
              min={-100}
              max={100}
              onChange={updateSetting("vibrance")}
            />
            <Slider
              label="饱和度"
              value={settings.saturation}
              min={-100}
              max={100}
              onChange={updateSetting("saturation")}
            />
            <Slider
              label="温度"
              value={settings.temperature}
              min={-100}
              max={100}
              onChange={updateSetting("temperature")}
            />
            <Slider
              label="色调"
              value={settings.tint}
              min={-100}
              max={100}
              onChange={updateSetting("tint")}
            />
            <Slider
              label="色相"
              value={settings.hue}
              min={-100}
              max={100}
              onChange={updateSetting("hue")}
            />
          </div>
          <div className="panel__group">
            <span className="panel__group-label">光亮</span>
            <Slider
              label="亮度"
              value={settings.brightness}
              min={-100}
              max={100}
              onChange={updateSetting("brightness")}
            />
            <Slider
              label="曝光度"
              value={settings.exposure}
              min={-100}
              max={100}
              onChange={updateSetting("exposure")}
            />
            <Slider
              label="对比度"
              value={settings.contrast}
              min={-100}
              max={100}
              onChange={updateSetting("contrast")}
            />
            <Slider
              label="黑色"
              value={settings.blacks}
              min={-100}
              max={100}
              onChange={updateSetting("blacks")}
            />
            <Slider
              label="白色"
              value={settings.whites}
              min={-100}
              max={100}
              onChange={updateSetting("whites")}
            />
            <Slider
              label="高光"
              value={settings.highlights}
              min={-100}
              max={100}
              onChange={updateSetting("highlights")}
            />
            <Slider
              label="暗调"
              value={settings.shadows}
              min={-100}
              max={100}
              onChange={updateSetting("shadows")}
            />
          </div>
          <div className="panel__group">
            <span className="panel__group-label">细节</span>
            <Slider
              label="锐化"
              value={settings.sharpen}
              min={0}
              max={100}
              onChange={updateSetting("sharpen")}
            />
            <Slider
              label="清晰度"
              value={settings.clarity}
              min={-100}
              max={100}
              onChange={updateSetting("clarity")}
            />
            <Slider
              label="平滑"
              value={settings.smooth}
              min={0}
              max={100}
              onChange={updateSetting("smooth")}
            />
            <Slider
              label="模糊"
              value={settings.blur}
              min={0}
              max={100}
              onChange={updateSetting("blur")}
            />
            <Slider
              label="颗粒"
              value={settings.grain}
              min={0}
              max={100}
              onChange={updateSetting("grain")}
            />
          </div>
          <div className="panel__group">
            <span className="panel__group-label">场景</span>
            <Slider
              label="暗角"
              value={settings.vignette}
              min={-100}
              max={100}
              onChange={updateSetting("vignette")}
            />
            <Slider
              label="氛围美化"
              value={settings.glamour}
              min={0}
              max={100}
              onChange={updateSetting("glamour")}
            />
            <Slider
              label="泛光"
              value={settings.bloom}
              min={0}
              max={100}
              onChange={updateSetting("bloom")}
            />
            <Slider
              label="除雾化"
              value={settings.dehaze}
              min={0}
              max={100}
              onChange={updateSetting("dehaze")}
            />
          </div>
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
          <button
            className="stage__action"
            onClick={() => fileInputRef.current?.click()}
          >
            替换图片
          </button>
          <button className="stage__action" onClick={handleExport}>
            导出图片
          </button>
        </div>
      </div>
    </div>
  );
};

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
