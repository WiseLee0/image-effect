import type { ProgramInfo, RenderTarget } from './types';

/**
 * 创建 WebGL 着色器
 */
export function createShader(
  gl: WebGLRenderingContext,
  type: GLenum,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * 创建 WebGL 程序
 */
export function createProgram(
  gl: WebGLRenderingContext,
  vs: WebGLShader,
  fs: WebGLShader
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * 构建程序信息
 */
export function buildProgram(
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string,
  uniforms: string[]
): ProgramInfo {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertex);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) {
    throw new Error('Shader compile failed.');
  }
  const program = createProgram(gl, vs, fs);
  if (!program) {
    throw new Error('Program link failed.');
  }
  const attribs = {
    aPosition: gl.getAttribLocation(program, 'aPosition'),
    aTexCoord: gl.getAttribLocation(program, 'aTexCoord'),
    apos: gl.getAttribLocation(program, 'apos'),
    auv: gl.getAttribLocation(program, 'auv'),
  };
  const uniformMap: Record<string, WebGLUniformLocation | null> = {};
  uniforms.forEach((name) => {
    uniformMap[name] = gl.getUniformLocation(program, name);
  });
  return { program, attribs, uniforms: uniformMap };
}

/**
 * 创建渲染目标
 */
export function createRenderTarget(
  gl: WebGLRenderingContext,
  width: number,
  height: number
): RenderTarget {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Unable to create texture');
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    throw new Error('Unable to create framebuffer');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  return { framebuffer, texture };
}

const PALETTE_SIZE = 256;

/**
 * 限制值在 0-1 范围内
 */
export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 三次贝塞尔曲线
 */
export const cubicBezier = (t: number, p0: number, p1: number, p2: number, p3: number): number => {
  const u = 1 - t;
  return (
    u * u * u * p0 +
    3 * u * u * t * p1 +
    3 * u * t * t * p2 +
    t * t * t * p3
  );
};

/**
 * 构建曲线调色板
 */
export const buildCurvePalette = (lowControl: number, highControl: number): Uint8Array => {
  const data = new Uint8Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i += 1) {
    const t = i / (PALETTE_SIZE - 1);
    const y = cubicBezier(t, 0, lowControl, highControl, 1);
    const v = Math.round(clamp01(y) * 255);
    const idx = i * 3;
    data[idx] = v;
    data[idx + 1] = v;
    data[idx + 2] = v;
  }
  return data;
};

/**
 * 构建黑色调色板
 */
export const buildBlackPalette = (amount: number): Uint8Array => {
  const amt = Math.max(-100, Math.min(100, amount)) / 100;
  const strength = 0.35;
  const lowControl = clamp01(0.33 - amt * strength);
  const highControl = 0.66;
  return buildCurvePalette(lowControl, highControl);
};

/**
 * 创建调色板纹理
 */
export const createPaletteTexture = (gl: WebGLRenderingContext, data: Uint8Array): WebGLTexture => {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Unable to create palette texture');
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGB,
    PALETTE_SIZE,
    1,
    0,
    gl.RGB,
    gl.UNSIGNED_BYTE,
    data
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

/**
 * 更新调色板纹理
 */
export const updatePaletteTexture = (
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  data: Uint8Array
): void => {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    PALETTE_SIZE,
    1,
    gl.RGB,
    gl.UNSIGNED_BYTE,
    data
  );
};

/**
 * 构建对比度矩阵
 */
export const buildContrastMatrix = (amount: number): Float32Array => {
  const t = Math.max(-100, Math.min(100, amount)) / 100;
  const scale = 1 + t;
  const offset = 0.5 * (1 - scale);
  return new Float32Array([
    scale, 0, 0, 0, offset,
    0, scale, 0, 0, offset,
    0, 0, scale, 0, offset,
    0, 0, 0, 1, 0,
  ]);
};

/**
 * 构建饱和度矩阵
 */
export const buildSaturationMatrix = (amount: number): Float32Array => {
  const t = Math.max(-100, Math.min(100, amount)) / 100;
  const scale = 1 + t;
  const lumR = 0.299;
  const lumG = 0.587;
  const lumB = 0.114;
  const inv = 1 - scale;
  return new Float32Array([
    inv * lumR + scale, inv * lumG, inv * lumB, 0, 0,
    inv * lumR, inv * lumG + scale, inv * lumB, 0, 0,
    inv * lumR, inv * lumG, inv * lumB + scale, 0, 0,
    0, 0, 0, 1, 0,
  ]);
};
