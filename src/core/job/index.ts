export type { CutGroup, CutSegment, FillGroup, FillSegment, Group, Job, RasterGroup } from './job';
export { EMPTY_JOB } from './job';
export { compileJob } from './compile-job';
export { DEFAULT_OVERSCAN_MM } from './compile-job-defaults';
export type { JobBounds } from './job-bounds';
export { computeJobBounds, computeJobMotionBounds } from './job-bounds';
export type { ComputeFrameBoundsOptions } from './frame-bounds';
export { computeFrameBounds } from './frame-bounds';
export { frameBoundsSignature } from './frame-verification';
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
  applyJobOriginOffset,
  jobOriginOffset,
  jobOriginOffsetFromBounds,
  offsetJobBounds,
} from './job-origin';
export { computeSceneOutputBounds } from './scene-output-bounds';
export { computeRegistrationBoxBounds } from './registration-placement';
export type { JobDurationEstimate } from './estimate-duration';
export { estimateJobDuration, formatDuration } from './estimate-duration';
export { optimizePaths } from './optimize-paths';
export type { SlicedToolpath, Toolpath, ToolpathDistanceSummary, ToolpathStep } from './toolpath';
export { buildToolpath, sliceToolpath, summarizeToolpathDistances } from './toolpath';
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
export type {
  ScanOffsetCalibrationCell,
  ScanOffsetCalibrationPattern,
  ScanOffsetCalibrationPatternOptions,
} from './scan-offset-calibration-pattern';
export { generateScanOffsetCalibrationPattern } from './scan-offset-calibration-pattern';
export type { ScanOffsetPoint } from './scan-offset';
export { offsetForSpeed, shiftAlongTravel } from './scan-offset';
export type { FillHeatRiskSummary } from './fill-heat-risk';
export { analyzeFillHeatRisk } from './fill-heat-risk';
