// G-code Inspector render model (ADR-255) — pure core: parsed-program
// geometry as typed arrays plus events, accountability, and stats.

export { buildGcodeRenderModel } from './gcode-render-model';
export { computeProgramStats } from './program-stats';
export { LINE_CATEGORY, SEG_KIND, SEG_MOTION } from './render-model-types';
export type {
  AxisBounds,
  BuildRenderModelOptions,
  BuildRenderModelResult,
  GcodeRenderModel,
  LineCategoryName,
  ProgramEvent,
  ProgramStats,
  SegKindName,
  SkippedMotion,
  UnsupportedWordCount,
} from './render-model-types';
