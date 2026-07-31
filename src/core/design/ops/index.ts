// core/design/ops — the Modify-rail operations (ADR-272, Phase N DS-6).
//
// Its own sub-barrel, like core/design/snap: the parent barrel stays well under the
// ADR-015 cap and trim / extend / offset / boolean can land here later without
// pressing on it.
//
// Every operation is pure and total. Each returns null for a case it cannot handle —
// a degenerate corner, a radius that will not fit — which the UI reports and never
// treats as an error (rule 7).

export { chamferPathCorner, cornerNeighbours, replaceVertex } from './chamfer-corner';
export type { CornerNeighbours } from './chamfer-corner';
export {
  angleOfMm,
  cornerSetback,
  filletCentreMm,
  filletSetbackMm,
  shortestSweepRad,
  type CornerSetback,
} from './corner-geometry';
export { filletPathCorner, type FilletResult } from './fillet-corner';
export { translateEntities, translateEntity } from './translate-entities';
