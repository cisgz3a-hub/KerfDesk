// core/cnc — CNC (router/mill) toolpath compilation. Public API.

export { compileCncJob, isProfileCutType } from './compile-cnc-job';
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
  type ChiploadMaterial,
  type FeedsCalculatorInput,
  type FeedsCalculatorResult,
} from './feeds-calculator';
export {
  buildSurfacingProgram,
  SURFACING_DEFAULT_DEPTH_PER_PASS_MM,
  SURFACING_DEFAULT_STEPOVER_PCT,
  SURFACING_DEFAULT_TOTAL_DEPTH_MM,
  surfacingRowYs,
  type SurfacingParams,
  type SurfacingProgram,
} from './surfacing';
