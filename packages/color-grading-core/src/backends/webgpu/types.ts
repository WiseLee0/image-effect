/**
 * WebGPU 后端类型定义
 */

/**
 * 管线 binding=2 槽位的占用方式（互斥）
 * - 'none'：只用 binding=0/1 的输入纹理与采样器
 * - 'uniform'：binding=2 是 uniform buffer
 * - 'extra-texture'：binding=2 是额外纹理，binding=3 是其采样器
 */
export type WebGPUPipelineBindingMode = 'none' | 'uniform' | 'extra-texture';

/**
 * WebGPU 管线信息
 */
export interface WebGPUPipelineInfo {
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  bindingMode: WebGPUPipelineBindingMode;
}

/**
 * WebGPU LUT 管线（独立的 binding 布局，包含 3D 纹理 + 双采样器）
 */
export interface WebGPULUTPipelineInfo {
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
 * WebGPU LUT 资源（动态加载）
 */
export interface WebGPULUTResources {
  texture: GPUTexture;
  view: GPUTextureView;
  sampler: GPUSampler;
  size: number;
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
  lutPipeline: WebGPULUTPipelineInfo;
  /** LUT 资源，未加载时为 null */
  lut: WebGPULUTResources | null;
  /** LUT 参数 uniform 缓冲区 */
  lutUniformBuffer: GPUBuffer;
  targets: [WebGPURenderTarget, WebGPURenderTarget];
  paletteTexture: GPUTexture | null;
  paletteTextureView: GPUTextureView | null;
  /** Persistent uniform buffer per pipeline; reused every frame via writeBuffer. */
  uniformBuffers: Record<string, GPUBuffer>;
  /** bindGroup cache keyed by pipeline name then input texture view. */
  bindGroupCache: Map<string, Map<GPUTextureView, GPUBindGroup>>;
  /** 语义肤色 mask 纹理。未启用时为 1×1 全白占位（shader 内通过 useSegMask flag 决定是否参与运算） */
  segMaskTexture: GPUTexture;
  segMaskView: GPUTextureView;
  segMaskSampler: GPUSampler;
  /** 是否启用语义 mask（外部 setSkinSegmentationMask 控制） */
  segMaskEnabled: boolean;
}
