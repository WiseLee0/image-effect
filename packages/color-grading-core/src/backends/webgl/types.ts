/**
 * WebGL 后端类型定义
 */

/**
 * WebGL 程序信息
 */
export interface WebGLProgramInfo {
  program: WebGLProgram;
  attribs: {
    aPosition: number;
    aTexCoord: number;
    apos: number;
    auv: number;
  };
  uniforms: Record<string, WebGLUniformLocation | null>;
}

/**
 * WebGL 渲染目标
 */
export interface WebGLRenderTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

/**
 * WebGL 资源
 */
export interface WebGLResources {
  gl: WebGLRenderingContext;
  width: number;
  height: number;
  sourceTexture: WebGLTexture;
  blackPalette: WebGLTexture;
  /** LUT 摊平后的 2D 纹理，未加载时为 null */
  lutTexture: WebGLTexture | null;
  /** LUT 维度（17/33/64 等），未加载时为 0 */
  lutSize: number;
  quad: {
    positionBuffer: WebGLBuffer;
    texCoordBuffer: WebGLBuffer;
  };
  programs: Record<string, WebGLProgramInfo>;
  targets: [WebGLRenderTarget, WebGLRenderTarget];
  /** 语义肤色 mask 纹理。未启用时为 1×1 全白占位 */
  segMaskTexture: WebGLTexture;
  /** 当前 mask 纹理宽度，用于热路径判断同尺寸时改走 texSubImage2D 复用 */
  segMaskWidth: number;
  /** 当前 mask 纹理高度 */
  segMaskHeight: number;
  /** 是否启用语义 mask（外部 setSkinSegmentationMask 控制） */
  segMaskEnabled: boolean;
}
