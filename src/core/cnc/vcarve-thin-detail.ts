// vcarveThinDetailRings — the fine-detail stage of v-carving (ADR-281).
//
// The δ-pitched ring ladder cannot see any sub-region narrower than 2δ: its
// first inset already consumes the region there, so a thin script stroke
// contributes no rings and silently vanishes from the carve while the rest
// of the glyph cuts — the toolpath "looks finished". The material the ladder
// DOES cover is exactly its first ring grown back out by δ (a morphological
// opening of the source); everything the opening misses — strokes narrower
// than 2δ, and sharp-corner tips the miter limit bevelled away — is carved
// here by a second ladder at a fixed fine pitch, which converges on each
// sliver's centerline: the shallow V-groove the artwork asks for.
//
// Ring geometry is found here; vcarve-ladder.ts assigns its emitted per-vertex
// depths against the normalized TRUE artwork boundary. Its conservative
// refinement bound preserves that profile across coarse/detail junctions.
//
// Purely additive and advisory-compatible (rule 7): geometry whose opening
// leaves no slivers keeps the legacy path; sharp tips may add detail. Engine
// failures surface as offsetFailed, and material still finer than the fine
// pitch is reported, never blocked.

import { pointInPolygon } from '../geometry';
import { offsetClosedPolylinesWithRoundJoinsChecked } from '../geometry/kerf-offset';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import {
  differenceClosedPolylinesChecked,
  normalizeClosedPolylinesEvenOddChecked,
} from '../geometry/polygon-difference';
import type { VectorOpError } from '../geometry/vector-path-tools';
import { ok, type Result } from '../result';
import type { Polyline } from '../scene';

// One fine ring every 0.05 mm carves any stroke down to 0.1 mm wide — half
// the ladder's own MIN_RESOLUTION_MM floor — with depth error bounded by
// pitch/tan(θ/2) (0.05 mm for a 90° bit). Fixed rather than user-set: it is
// a fidelity floor, not a speed/quality trade the operator should discover.
export const THIN_DETAIL_RESOLUTION_MM = 0.05;
// Same backstop philosophy as the ladder's MAX_VCARVE_RINGS: a sliver's
// inradius is < δ by construction, so real detail ladders stop after about
// δ/pitch steps; this only catches degenerate inputs.
const MAX_THIN_DETAIL_RINGS = 8192;
// Coverage is compared against the source on clipper's 3-decimal grid; this
// slack swallows the tangency hairlines rounding leaves along the seam so
// they cannot masquerade as lost artwork.
const COVERAGE_SLACK_MM = 0.002;
export type ThinDetailRings = {
  // Step-indexed at THIN_DETAIL_RESOLUTION_MM pitch, like ladder rings at δ.
  readonly rings: ReadonlyArray<ReadonlyArray<Polyline>>;
  readonly offsetFailed: boolean;
  // True when a visible sliver was too thin even for the fine pitch — that
  // material stays uncut and Job Review should say so (advisory only).
  readonly residualThin: boolean;
  // True when the fine ladder hit its ring budget with interior remaining —
  // reported as a pass-limit advisory, never a refusal (rule 7, #584).
  readonly capped: boolean;
  // Filled roots of the uncovered slivers, in engine order — the grouping key
  // for sliver-major emission (vcarve-detail-order.ts).
  readonly sliverRoots: ReadonlyArray<Polyline>;
};

/**
 * Fine-pitch rings for every part of `sourceContours` the δ ladder's first
 * ring does not cover. `firstRing` is the ladder's step-0 output — empty when
 * the whole region is thinner than 2δ, in which case everything is detail.
 * `finePitchMm` defaults to THIN_DETAIL_RESOLUTION_MM; a depth-clamped carve
 * passes a tighter pitch so fine footprints overlap too (#575).
 */
export function vcarveThinDetailRings(
  sourceContours: ReadonlyArray<Polyline>,
  firstRing: ReadonlyArray<Polyline>,
  coarseInsetMm: number,
  finePitchMm: number = THIN_DETAIL_RESOLUTION_MM,
): ThinDetailRings {
  const uncovered = uncoveredByFirstRing(sourceContours, firstRing, coarseInsetMm);
  if (uncovered.kind === 'error') {
    return { rings: [], offsetFailed: true, residualThin: false, capped: false, sliverRoots: [] };
  }
  if (uncovered.value.length === 0) {
    return { rings: [], offsetFailed: false, residualThin: false, capped: false, sliverRoots: [] };
  }
  // The source may be a self-intersecting even-odd contour. Clipper can inset
  // that raw winding in the wrong direction, so resolve it into filled roots
  // before any fine ladder is allowed to emit paths.
  const normalized = normalizeClosedPolylinesEvenOddChecked(uncovered.value);
  if (normalized.kind === 'error') {
    return { rings: [], offsetFailed: true, residualThin: false, capped: false, sliverRoots: [] };
  }
  if (normalized.value.length === 0) {
    return { rings: [], offsetFailed: false, residualThin: false, capped: false, sliverRoots: [] };
  }
  const slivers = normalized.value;
  const fine = buildOffsetLadder(
    slivers,
    MAX_THIN_DETAIL_RINGS,
    (step) => (step + 1) * finePitchMm,
  );
  const residual = residualThinResult(slivers, fine.rings[0] ?? [], finePitchMm);
  return {
    rings: fine.rings,
    offsetFailed: fine.offsetFailed || residual.kind === 'error',
    residualThin: residual.kind === 'ok' ? residual.value : false,
    capped: fine.capped,
    sliverRoots: sliverRoots(slivers),
  };
}

// Source minus (first ring ⊕ δ): the exact material no coarse ring's bit cone
// touches. Deeper rings cover strictly less, so only the first ring matters.
function uncoveredByFirstRing(
  sourceContours: ReadonlyArray<Polyline>,
  firstRing: ReadonlyArray<Polyline>,
  coarseInsetMm: number,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  if (firstRing.length === 0) return ok(sourceContours);
  const covered = offsetClosedPolylinesWithRoundJoinsChecked(
    firstRing,
    coarseInsetMm + COVERAGE_SLACK_MM,
  );
  if (covered.kind === 'error') return covered;
  return differenceClosedPolylinesChecked(sourceContours, covered.value);
}

// Exact residual: sliver material the fine rings' bit cones do not touch —
// the same opening law the detail stage itself applies, one level down. This
// catches a sub-pitch tail attached to an otherwise-rescued sliver, which a
// per-root "did any ring land here" test misses.
function residualThinResult(
  slivers: ReadonlyArray<Polyline>,
  fineFirstRing: ReadonlyArray<Polyline>,
  finePitchMm: number,
): Result<boolean, VectorOpError> {
  const residual = uncoveredByFirstRing(slivers, fineFirstRing, finePitchMm);
  // Preserve the failure so the existing geometry advisory reports that the
  // detail stage became incomplete. Already-generated rings remain usable.
  if (residual.kind === 'error') return residual;
  // COVERAGE_SLACK_MM already absorbs the rounding seam. Any finite,
  // non-collinear root that remains is representable artwork and must not
  // disappear merely because each component is small.
  return ok(sliverRoots(residual.value).some(hasFiniteNonCollinearPoints));
}

// Shoelace area is not a safe presence test for even-odd artwork: a valid
// bow-tie can have equal lobes whose signed areas cancel. Three finite,
// non-collinear vertices prove the residual has two-dimensional geometry;
// collinear/point-only contours remain naturally empty.
function hasFiniteNonCollinearPoints(polyline: Polyline): boolean {
  const origin = polyline.points.find(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (origin === undefined) return false;
  let direction: { readonly x: number; readonly y: number } | null = null;
  for (const point of polyline.points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    if (dx === 0 && dy === 0) continue;
    if (direction === null) {
      direction = { x: dx, y: dy };
      continue;
    }
    if (direction.x * dy - direction.y * dx !== 0) return true;
  }
  return false;
}

// Every even-odd filled root of the uncovered slivers, engine order, no area
// floor — tiny corner wedges still own their rings for ordering purposes.
function sliverRoots(slivers: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  return slivers.filter((candidate, index) => {
    const probe = candidate.points[0];
    if (probe === undefined) return false;
    const containmentDepth = slivers.reduce((count, other, otherIndex) => {
      if (otherIndex === index) return count;
      return pointInPolygon(probe, other.points) ? count + 1 : count;
    }, 0);
    return containmentDepth % 2 === 0;
  });
}
