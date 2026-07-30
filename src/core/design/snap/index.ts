// core/design/snap — the object-snap engine (ADR-268, Phase N DS-4).
//
// Its own sub-barrel rather than more exports on core/design, following the
// core/shapes/primitives precedent: the parent barrel stays well under the
// ADR-015 cap and snapping can grow (tangent, perpendicular, angle tracking)
// without pressing on it.
//
// Everything here is pure. Tolerance arrives in millimetres and the caller owns
// the pixel-to-millimetre conversion, so the engine never needs to know the zoom.

export { entitySnapPoints } from './entity-snap-points';
export { intersectionTargets, segmentCrossing } from './snap-intersections';
export {
  ALL_SNAP_KINDS,
  isBetterSnap,
  snapPriority,
  type SnapKind,
  type SnapTarget,
} from './snap-kinds';
export {
  closestPointOnSegment,
  entitySegments,
  sketchSegments,
  type SnapSegment,
} from './snap-segments';
export { resolveSnap, type SnapQuery, type SnapResult } from './resolve-snap';
