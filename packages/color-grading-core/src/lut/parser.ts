/**
 * .cube LUT 解析器
 *
 * 支持 Adobe Cube LUT 格式（v1.0），仅支持 3D LUT。
 * 参考：https://wwwimages2.adobe.com/content/dam/acom/en/products/speedgrade/cc/pdfs/cube-lut-specification-1.0.pdf
 */

export interface CubeLUT {
  /** LUT 维度（通常为 17 / 33 / 64） */
  size: number;
  /**
   * 体数据，长度为 size^3 * 3，按 (R 最快, G 中, B 最慢) 顺序排列。
   * 每个采样点 3 个 float32（R/G/B），值域通常 [0, 1]
   */
  data: Float32Array;
  /** 输入域最小值（默认 [0, 0, 0]） */
  domainMin: [number, number, number];
  /** 输入域最大值（默认 [1, 1, 1]） */
  domainMax: [number, number, number];
  /** 可选标题 */
  title?: string;
}

/**
 * 解析 .cube 文本为 CubeLUT 数据结构
 *
 * @throws 当格式非法或包含不支持的指令（如 LUT_1D_SIZE）时
 */
export function parseCubeLUT(text: string): CubeLUT {
  const lines = text.split(/\r?\n/);

  let size = 0;
  let title: string | undefined;
  const domainMin: [number, number, number] = [0, 0, 0];
  const domainMax: [number, number, number] = [1, 1, 1];
  const triplets: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const tokens = line.split(/\s+/);
    const head = tokens[0].toUpperCase();

    if (head === 'TITLE') {
      const m = line.match(/"([^"]*)"/);
      title = m?.[1] ?? tokens.slice(1).join(' ');
      continue;
    }
    if (head === 'LUT_3D_SIZE') {
      size = parseInt(tokens[1], 10);
      if (!Number.isFinite(size) || size < 2 || size > 256) {
        throw new Error(`Invalid LUT_3D_SIZE: ${tokens[1]}`);
      }
      continue;
    }
    if (head === 'LUT_1D_SIZE') {
      throw new Error('1D LUTs are not supported, only LUT_3D_SIZE is allowed');
    }
    if (head === 'DOMAIN_MIN') {
      domainMin[0] = parseFloat(tokens[1]);
      domainMin[1] = parseFloat(tokens[2]);
      domainMin[2] = parseFloat(tokens[3]);
      continue;
    }
    if (head === 'DOMAIN_MAX') {
      domainMax[0] = parseFloat(tokens[1]);
      domainMax[1] = parseFloat(tokens[2]);
      domainMax[2] = parseFloat(tokens[3]);
      continue;
    }

    // 数据行
    if (tokens.length >= 3) {
      const r = parseFloat(tokens[0]);
      const g = parseFloat(tokens[1]);
      const b = parseFloat(tokens[2]);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        throw new Error(`Invalid sample at line ${i + 1}: ${line}`);
      }
      triplets.push(r, g, b);
    }
  }

  if (size === 0) {
    throw new Error('Missing LUT_3D_SIZE directive');
  }
  const expectedTriplets = size * size * size;
  if (triplets.length / 3 !== expectedTriplets) {
    throw new Error(
      `Sample count mismatch: expected ${expectedTriplets}, got ${triplets.length / 3}`,
    );
  }

  return {
    size,
    data: new Float32Array(triplets),
    domainMin,
    domainMax,
    title,
  };
}

/**
 * 把 CubeLUT 数据转为 RGBA8 字节数组（webgl/webgpu 上传纹理用）
 *
 * 顺序与原 .cube 一致：R 最快、G 中、B 最慢。
 * 输出长度为 size^3 * 4
 */
export function lutToRGBA8(lut: CubeLUT): Uint8Array {
  const { data, size, domainMin, domainMax } = lut;
  const total = size * size * size;
  const out = new Uint8Array(total * 4);
  const dxR = domainMax[0] - domainMin[0] || 1;
  const dxG = domainMax[1] - domainMin[1] || 1;
  const dxB = domainMax[2] - domainMin[2] || 1;

  for (let i = 0; i < total; i++) {
    const r = (data[i * 3] - domainMin[0]) / dxR;
    const g = (data[i * 3 + 1] - domainMin[1]) / dxG;
    const b = (data[i * 3 + 2] - domainMin[2]) / dxB;
    out[i * 4] = Math.max(0, Math.min(255, Math.round(r * 255)));
    out[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
    out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * 把 3D LUT 摊平成 2D 切片 (size*size 宽, size 高)，供 WebGL 1.0 使用
 *
 * 布局：z 切片横向排列，每片为 size×size 的 RG 平面，第 k 片放在 x ∈ [k*size, (k+1)*size)
 */
export function lutToFlat2D(lut: CubeLUT): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const { size, data, domainMin, domainMax } = lut;
  const width = size * size;
  const height = size;
  const out = new Uint8Array(width * height * 4);
  const dxR = domainMax[0] - domainMin[0] || 1;
  const dxG = domainMax[1] - domainMin[1] || 1;
  const dxB = domainMax[2] - domainMin[2] || 1;

  // 原数据顺序 (R 最快, G 中, B 最慢)：index = bSlice*size*size + gRow*size + rCol
  for (let bSlice = 0; bSlice < size; bSlice++) {
    for (let gRow = 0; gRow < size; gRow++) {
      for (let rCol = 0; rCol < size; rCol++) {
        const srcIdx = (bSlice * size * size + gRow * size + rCol) * 3;
        const dstX = bSlice * size + rCol;
        const dstY = gRow;
        const dstIdx = (dstY * width + dstX) * 4;
        const r = (data[srcIdx] - domainMin[0]) / dxR;
        const g = (data[srcIdx + 1] - domainMin[1]) / dxG;
        const b = (data[srcIdx + 2] - domainMin[2]) / dxB;
        out[dstIdx] = Math.max(0, Math.min(255, Math.round(r * 255)));
        out[dstIdx + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        out[dstIdx + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        out[dstIdx + 3] = 255;
      }
    }
  }
  return { width, height, data: out };
}
