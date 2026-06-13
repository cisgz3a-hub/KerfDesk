export type { CutGroup, CutSegment, FillGroup, Group, Job, RasterGroup } from './job';
export { EMPTY_JOB } from './job';
export { compileJob, DEFAULT_OVERSCAN_MM } from './compile-job';
export type { JobBounds } from './job-bounds';
export { computeJobBounds } from './job-bounds';
export type { ComputeFrameBoundsOptions } from './frame-bounds';
export { computeFrameBounds } from './frame-bounds';
export type { RasterMachineBounds } from './raster-bounds';
export { rasterBoundsInMachineCoords } from './raster-bounds';
export {
  countEstimatedFillSegments,
  countOutputVectorSegments,
  PREPARATION_COMPILED_SEGMENT_BUDGET,
  PREPARATION_RAW_VECTOR_SEGMENT_BUDGET,
  scenePreparationTooComplex,
} from './preparation-complexity';
export type { FramePreflight } from './frame-preflight';
export { describeFramePreflightFailure, framePreflight } from './frame-preflight';
export type {
  JobOriginAnchor,
  JobOriginPlacement,
  JobPlacementSettings,
  JobStartMode,
} from './job-origin';
export {
  ABSOLUTE_JOB_PLACEMENT,
  JOB_ORIGIN_ANCHORS,
  USER_ORIGIN_JOB_PLACEMENT,
  applyJobOrigin,
  jobOriginOffset,
  offsetJobBounds,
} from './job-origin';
export type { JobDurationEstimate } from './estimate-duration';
export { estimateJobDuration, formatDuration } from './estimate-duration';
export { optimizePaths } from './optimize-paths';
export type { SlicedToolpath, Toolpath, ToolpathStep } from './toolpath';
export { buildToolpath, sliceToolpath } from './toolpath';
export type {
  MaterialTestCell,
  MaterialTestGrid,
  MaterialTestGridOptions,
} from './material-test-grid';
export { generateMaterialTestGrid } from './material-test-grid';
export type {
  IntervalTestCell,
  IntervalTestGrid,
  IntervalTestGridOptions,
} from './interval-test-grid';
export { generateIntervalTestGrid } from './interval-test-grid';
