// core/design-carve — the instant carve preview surface (ADR-272 Amendment 1
// clause 4): design layers in, one target-surface Heightmap out. Pure typed
// arrays only; steppedSurfaceMesh (core/heightfield) renders the result at the
// UI boundary. Its own module because core/sim sits at the export cap and this
// is design-time math, not job simulation.

export {
  FALLBACK_V_TIP_ANGLE_DEG,
  MIN_CARVE_CELL_MM,
  carveLayerTool,
  type CarveStock,
  type DesignCarveInput,
} from './carve-input';
export { designCarveHeightmap } from './carve-heightmap';
export { mergeRemovalDepthsInto } from './grid-merge';
