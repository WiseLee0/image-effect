# image-color-grading

基于 WebGL 的高性能图像调色库，支持 22+ 种专业级调色参数，可用于图像编辑、滤镜应用等场景。

## 特性

- 🚀 **高性能** - 基于 WebGL 的 GPU 加速渲染
- 🎨 **丰富的调色参数** - 支持 22+ 种专业调色参数
- 📦 **零依赖** - 无任何第三方依赖
- 🔧 **易于使用** - 简洁的 API 设计
- 📱 **跨平台** - 支持所有现代浏览器
- 💪 **TypeScript** - 完整的类型定义

## 安装

```bash
npm install image-color-grading
```

```bash
yarn add image-color-grading
```

```bash
pnpm add image-color-grading
```

## 快速开始

```typescript
import { ImageColorGrading } from 'image-color-grading';

// 创建处理器实例
const processor = new ImageColorGrading();

// 加载图像
await processor.loadImage('path/to/image.jpg');

// 设置调色参数
processor.setSettings({
  brightness: 20,
  contrast: 10,
  saturation: 15,
  vibrance: 25,
});

// 导出为 Data URL
const dataUrl = processor.toDataURL();

// 或导出为 Blob
const blob = await processor.toBlob({ format: 'image/jpeg', quality: 0.9 });
```

## API 文档

### ImageColorGrading

主要的图像调色处理器类。

#### 构造函数

```typescript
const processor = new ImageColorGrading(canvas?: HTMLCanvasElement);
```

- `canvas` - 可选，自定义 canvas 元素。不传则自动创建。

#### 方法

##### loadImage(url: string): Promise\<void\>

从 URL 加载图像。

```typescript
await processor.loadImage('https://example.com/image.jpg');
```

##### loadFromImage(image: HTMLImageElement): void

从 HTMLImageElement 加载图像。

```typescript
const img = document.querySelector('img');
processor.loadFromImage(img);
```

##### loadFromFile(file: File): Promise\<void\>

从 File 对象加载图像（适用于文件上传）。

```typescript
const input = document.querySelector('input[type="file"]');
input.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  await processor.loadFromFile(file);
});
```

##### loadFromImageData(imageData: ImageData): void

从 ImageData 加载图像。

```typescript
const imageData = ctx.getImageData(0, 0, width, height);
processor.loadFromImageData(imageData);
```

##### setSettings(settings: PartialColorGradingSettings): void

设置调色参数（支持部分更新）。

```typescript
processor.setSettings({
  brightness: 20,
  contrast: 10,
});
```

##### getSettings(): ColorGradingSettings

获取当前的调色设置。

```typescript
const settings = processor.getSettings();
console.log(settings.brightness); // 20
```

##### resetSettings(): void

重置所有设置为默认值。

```typescript
processor.resetSettings();
```

##### render(): void

手动触发渲染（通常在 setSettings 后自动调用）。

```typescript
processor.render();
```

##### toDataURL(options?: ExportOptions): string

导出为 Data URL 字符串。

```typescript
// 导出为 PNG
const pngUrl = processor.toDataURL();

// 导出为 JPEG，质量 90%
const jpegUrl = processor.toDataURL({ 
  format: 'image/jpeg', 
  quality: 0.9 
});
```

##### toBlob(options?: ExportOptions): Promise\<Blob\>

导出为 Blob 对象。

```typescript
const blob = await processor.toBlob({ 
  format: 'image/png' 
});

// 下载文件
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'edited-image.png';
a.click();
```

##### getImageData(): ImageData

获取处理后的 ImageData。

```typescript
const imageData = processor.getImageData();
```

##### getCanvas(): HTMLCanvasElement

获取 canvas 元素。

```typescript
const canvas = processor.getCanvas();
document.body.appendChild(canvas);
```

##### getSize(): { width: number; height: number }

获取图像尺寸。

```typescript
const { width, height } = processor.getSize();
```

##### isLoaded(): boolean

检查是否已加载图像。

```typescript
if (processor.isLoaded()) {
  processor.setSettings({ brightness: 10 });
}
```

##### dispose(): void

销毁资源，释放 WebGL 上下文。

```typescript
processor.dispose();
```

### 调色参数

所有参数的默认值为 `0`。

| 参数 | 中文名 | 范围 | 说明 |
|------|--------|------|------|
| `vibrance` | 自然饱和度 | -100 ~ 100 | 智能增强/降低饱和度，保护肤色 |
| `saturation` | 饱和度 | -100 ~ 100 | 整体色彩饱和度调整 |
| `temperature` | 色温 | -100 ~ 100 | 冷暖色调调整 |
| `tint` | 色调 | -100 ~ 100 | 绿/品红色调偏移 |
| `hue` | 色相 | -100 ~ 100 | 色相旋转 |
| `brightness` | 亮度 | -100 ~ 100 | 整体亮度调整 |
| `exposure` | 曝光度 | -100 ~ 100 | 模拟相机曝光调整 |
| `contrast` | 对比度 | -100 ~ 100 | 明暗对比调整 |
| `blacks` | 黑色 | -100 ~ 100 | 暗部色阶调整 |
| `whites` | 白色 | -100 ~ 100 | 亮部色阶调整 |
| `highlights` | 高光 | -100 ~ 100 | 高光区域亮度调整 |
| `shadows` | 暗调 | -100 ~ 100 | 阴影区域亮度调整 |
| `dehaze` | 除雾化 | 0 ~ 100 | 去除雾霾效果 |
| `bloom` | 泛光 | 0 ~ 100 | 高光溢出效果 |
| `glamour` | 氛围美化 | 0 ~ 100 | 柔光美化效果 |
| `clarity` | 清晰度 | -100 ~ 100 | 局部对比度增强 |
| `sharpen` | 锐化 | 0 ~ 100 | 边缘锐化 |
| `smooth` | 平滑 | 0 ~ 100 | 平滑降噪 |
| `blur` | 模糊 | 0 ~ 100 | 高斯模糊 |
| `vignette` | 暗角 | -100 ~ 100 | 边缘暗角效果 |
| `grain` | 颗粒 | 0 ~ 100 | 胶片颗粒效果 |

### 类型定义

```typescript
// 完整的调色设置
interface ColorGradingSettings {
  vibrance: number;
  saturation: number;
  temperature: number;
  tint: number;
  hue: number;
  brightness: number;
  exposure: number;
  contrast: number;
  blacks: number;
  whites: number;
  highlights: number;
  shadows: number;
  dehaze: number;
  bloom: number;
  glamour: number;
  clarity: number;
  sharpen: number;
  smooth: number;
  blur: number;
  vignette: number;
  grain: number;
}

// 部分设置（用于 setSettings）
type PartialColorGradingSettings = Partial<ColorGradingSettings>;

// 导出选项
interface ExportOptions {
  format?: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number; // 0-1, 仅对 jpeg/webp 有效
}
```

## 示例

### 在 React 中使用

```tsx
import { useEffect, useRef, useState } from 'react';
import { ImageColorGrading, ColorGradingSettings } from 'image-color-grading';

function ImageEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const processorRef = useRef<ImageColorGrading | null>(null);
  const [settings, setSettings] = useState<Partial<ColorGradingSettings>>({});

  useEffect(() => {
    const processor = new ImageColorGrading();
    processorRef.current = processor;

    // 将 canvas 添加到 DOM
    if (containerRef.current) {
      containerRef.current.appendChild(processor.getCanvas());
    }

    // 加载图像
    processor.loadImage('/sample.jpg');

    return () => {
      processor.dispose();
    };
  }, []);

  useEffect(() => {
    processorRef.current?.setSettings(settings);
  }, [settings]);

  return (
    <div>
      <div ref={containerRef} />
      <input
        type="range"
        min="-100"
        max="100"
        value={settings.brightness ?? 0}
        onChange={(e) => setSettings({ ...settings, brightness: Number(e.target.value) })}
      />
    </div>
  );
}
```

### 在 Vue 中使用

```vue
<template>
  <div>
    <div ref="container"></div>
    <input
      type="range"
      :min="-100"
      :max="100"
      v-model.number="brightness"
      @input="updateSettings"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { ImageColorGrading } from 'image-color-grading';

const container = ref(null);
const brightness = ref(0);
let processor = null;

onMounted(async () => {
  processor = new ImageColorGrading();
  container.value.appendChild(processor.getCanvas());
  await processor.loadImage('/sample.jpg');
});

onUnmounted(() => {
  processor?.dispose();
});

function updateSettings() {
  processor?.setSettings({ brightness: brightness.value });
}
</script>
```

### 批量处理图像

```typescript
import { ImageColorGrading } from 'image-color-grading';

async function batchProcess(imageUrls: string[], settings: Partial<ColorGradingSettings>) {
  const processor = new ImageColorGrading();
  const results: Blob[] = [];

  for (const url of imageUrls) {
    await processor.loadImage(url);
    processor.setSettings(settings);
    const blob = await processor.toBlob({ format: 'image/jpeg', quality: 0.85 });
    results.push(blob);
  }

  processor.dispose();
  return results;
}
```

### 创建预设滤镜

```typescript
import { ImageColorGrading, PartialColorGradingSettings } from 'image-color-grading';

// 定义预设滤镜
const presets: Record<string, PartialColorGradingSettings> = {
  vintage: {
    saturation: -20,
    contrast: 10,
    temperature: 15,
    grain: 30,
    vignette: 25,
  },
  blackAndWhite: {
    saturation: -100,
    contrast: 20,
  },
  vivid: {
    vibrance: 40,
    saturation: 20,
    contrast: 15,
    clarity: 20,
  },
  cinematic: {
    contrast: 25,
    highlights: -20,
    shadows: 15,
    temperature: -10,
    vignette: 30,
  },
};

// 应用预设
function applyPreset(processor: ImageColorGrading, presetName: string) {
  processor.resetSettings();
  processor.setSettings(presets[presetName]);
}
```

## 浏览器兼容性

| 浏览器 | 最低版本 |
|--------|----------|
| Chrome | 56+ |
| Firefox | 51+ |
| Safari | 15+ |
| Edge | 79+ |

## 注意事项

1. **跨域图像** - 加载跨域图像时，服务器需要设置正确的 CORS 头
2. **内存管理** - 处理完成后调用 `dispose()` 释放 WebGL 资源
3. **图像尺寸** - 超大图像可能会影响性能，建议在客户端进行适当的缩放

## License

MIT
