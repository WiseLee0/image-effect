/**
 * 语义分割模块
 *
 * 把"这块像素是不是皮肤"从颜色判据升级为语义判据。
 * 像素判据（YCbCr 椭圆 + Kovac RGB）无法区分皮肤和肉色物体，
 * 需要用 CNN 分割模型输出的人体/皮肤蒙版来兜住误判。
 */

export type {
  SkinSegmentationProvider,
  SkinSegmentationResult,
  SkinSegmenterOptions,
  SkinSegmentationSource,
} from './types';

export { MediaPipeSkinSegmenter } from './mediapipe';
