// core/cnc — CNC (router/mill) toolpath compilation. Public API.

export { compileCncJob, isProfileCutType } from './compile-cnc-job';
export { findDroppedCncLayers } from './compile-cnc-diagnostics';
export { findCncHelicalEntryIssues, type CncHelicalEntryIssue } from './cnc-helical-issues';
export { planHelicalPocketPasses, type HelicalEntryPlan } from './helical-entry';
export { planRestPocketToolpaths, type RestPocketPlan } from './rest-pocket';
export {
  planAdaptivePocket,
  type AdaptivePocketPlan,
  type AdaptivePocketSequence,
} from './adaptive-pocket';
export { verifyAdaptivePocket, type AdaptivePocketVerification } from './adaptive-pocket-verifier';
export {
  adaptiveOptimalLoadMm,
  adaptivePocketPasses,
  adaptivePocketPassesForSettings,
  resolveAdaptivePocketOperation,
  type AdaptivePocketOperation,
} from './adaptive-pocket-operation';
export { findCncAdaptivePocketIssues, type CncAdaptivePocketIssue } from './cnc-adaptive-issues';
export { findCncRestPocketIssues, type CncRestPocketIssue } from './cnc-rest-issues';
export { zPassDepths } from './depth-passes';
export { profileToolpathPolylines, type ProfileSide } from './profile-paths';
export { pocketToolpathRaster, pocketToolpathRings } from './pocket-paths';
export { passNeedsTabs, splitPassForTabs, tabTopZMm, type CncTabSettings } from './cnc-tabs';
export {
  planTiles,
  REGISTRATION_HOLE_DEPTH_MM,
  tileFileName,
  tileJobs,
  type CncTile,
  type TiledJob,
} from './tile-plan';
export {
  calculateFeeds,
  CHIPLOAD_MATERIALS,
  chiploadFor,
  isChiploadMaterialKey,
  type ChiploadMaterial,
  type FeedsCalculatorInput,
  type FeedsCalculatorResult,
} from './feeds-calculator';
export { CNC_MACHINE_CATALOG, type CncMachinePreset } from './cnc-machine-catalog';
export {
  buildSurfacingProgram,
  SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
  SURFACING_DEFAULT_STEPOVER_PCT,
  SURFACING_DEFAULT_TOTAL_DEPTH_MM,
  surfacingRowYs,
  type SurfacingParams,
  type SurfacingProgram,
  type SurfacingProgramResult,
  type SurfacingRowsResult,
} from './surfacing';
