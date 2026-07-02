// core/cnc — CNC (router/mill) toolpath compilation. Public API.

export { compileCncJob, isProfileCutType } from './compile-cnc-job';
export { zPassDepths } from './depth-passes';
export { profileToolpathPolylines, type ProfileSide } from './profile-paths';
export { pocketToolpathRings } from './pocket-paths';
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
