/**
 * WebGPU 后端类型定义
 */

/**
 * WebGPU 管线信息
 */
export interface WebGPUPipelineInfo {
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
}

/**
 * WebGPU 渲染目标
 */
export interface WebGPURenderTarget {
  texture: GPUTexture;
  view: GPUTextureView;
}

/**
 * WebGPU 资源
 */
export interface WebGPUResources {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  width: number;
  height: number;
  sourceTexture: GPUTexture;
  sourceTextureView: GPUTextureView;
  sampler: GPUSampler;
  vertexBuffer: GPUBuffer;
  pipelines: Record<string, WebGPUPipelineInfo>;
  targets: [WebGPURenderTarget, WebGPURenderTarget];
  paletteTexture: GPUTexture | null;
  paletteTextureView: GPUTextureView | null;
}
