/**
 * 图像分析工具
 */

import type { ImageAnalysis, ImageLevels } from './types';

/**
 * 分析图像获取黑白色阶信息
 * 使用直方图分析，忽略极端少数的像素值
 */
export function analyzeImageLevels(imageData: ImageData): ImageLevels {
  const { data, width, height } = imageData;
  const histogram = new Array(256).fill(0);

  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]] += 1;
    histogram[data[i + 1]] += 1;
    histogram[data[i + 2]] += 1;
  }

  const threshold = Math.round((width * height) / 1e3);

  let black = 0;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > threshold) {
      black = i;
      break;
    }
  }

  let white = 255;
  for (let i = 255; i >= 0; i--) {
    if (histogram[i] > threshold) {
      white = i;
      break;
    }
  }

  if (black > 100) black = 100;
  if (white < 155) white = 155;

  return { black, white };
}

/**
 * 分析图像的饱和度/鲜艳度
 */
export function analyzeImageVibrance(imageData: ImageData): number {
  const { data, width, height } = imageData;
  let saturationSum = 1;
  let brightnessSum = 1;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);

    brightnessSum += max / 255;

    const chroma = max - min;
    if (chroma > 0) {
      saturationSum += chroma / max;
    }
  }

  const pixelCount = width * height;
  return (saturationSum + brightnessSum) / (pixelCount * 2);
}

export function analyzeImage(imageData: ImageData): ImageAnalysis {
  return {
    levels: analyzeImageLevels(imageData),
    vibrance: analyzeImageVibrance(imageData),
  };
}
