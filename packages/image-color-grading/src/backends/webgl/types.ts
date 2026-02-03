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
  quad: {
    positionBuffer: WebGLBuffer;
    texCoordBuffer: WebGLBuffer;
  };
  programs: Record<string, WebGLProgramInfo>;
  targets: [WebGLRenderTarget, WebGLRenderTarget];
}
