// vcarveThinDetailRings — the fine-detail stage of v-carving (ADR-279).
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
// Detail depths measure the inset from the SLIVER boundary. Along a stroke's
// sides that boundary is the artwork edge, so the depth law is exact; across
// the artificial cut where a sliver meets ladder-covered material the rings
// sit shallower than the true groove for about one δ of travel — an
// under-cut, never a gouge.
//
// Purely additive and advisory-compatible (rule 7): wide artwork produces no
// slivers and byte-identical output, engine failures surface as offsetFailed,
// and material still finer than the fine pitch is reported, never blocked.

import { pointInPolygon } from '../geometry';
import { offsetClosedPolylinesWithRoundJoinsChecked } from '../geometry/kerf-offset';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import { differenceClosedPolylinesChecked } from '../geometry/polygon-difference';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
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
// Slivers below this area are rounding dust or sub-visible detail; they
// never produce rings and must not raise the "detail dropped" advisory.
const MIN_RESIDUAL_AREA_MM2 = 0.01;

export type ThinDetailRings = {
  // Step-indexed at THIN_DETAIL_RESOLUTION_MM pitch, like ladder rings at δ.
  readonly rings: ReadonlyArray<ReadonlyArray<Polyline>>;
  readonly offsetFailed: boolean;
  // True when a visible sliver was too thin even for the fine pitch — that
  // material stays uncut and Job Review should say so (advisory only).
  readonly residualThin: boolean;
};

/**
 * Fine-pitch rings for every part of `sourceContours` the δ ladder's first
 * ring does not cover. `firstRing` is the ladder's step-0 output — empty when
 * the whole region is thinner than 2δ, in which case everything is detail.
 */
export function vcarveThinDetailRings(
  sourceContours: ReadonlyArray<Polyline>,
  firstRing: ReadonlyArray<Polyline>,
  coarseInsetMm: number,
): ThinDetailRings {
  const uncovered = uncoveredByFirstRing(sourceContours, firstRing, coarseInsetMm);
  if (uncovered.kind === 'error') return { rings: [], offsetFailed: true, residualThin: false };
  if (uncovered.value.length === 0) {
    return { rings: [], offsetFailed: false, residualThin: false };
  }
  const fine = buildOffsetLadder(
    uncovered.value,
    MAX_THIN_DETAIL_RINGS,
    (step) => (step + 1) * THIN_DETAIL_RESOLUTION_MM,
  );
  return {
    rings: fine.rings,
    offsetFailed: fine.offsetFailed,
    residualThin: hasUnrescuedSliver(uncovered.value, fine.rings),
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

// A sliver root (even-odd filled loop) that no fine ring landed inside is
// artwork below the fine pitch: it stays uncut.
function hasUnrescuedSliver(
  slivers: ReadonlyArray<Polyline>,
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
): boolean {
  const ringLoops = rings.flat();
  return sliverRoots(slivers).some((root) => !hasRingInside(ringLoops, root));
}

function sliverRoots(slivers: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  return slivers.filter((candidate, index) => {
    if (Math.abs(signedAreaMm2(candidate.points)) < MIN_RESIDUAL_AREA_MM2) return false;
    const probe = candidate.points[0];
    if (probe === undefined) return false;
    const containmentDepth = slivers.reduce((count, other, otherIndex) => {
      if (otherIndex === index) return count;
      return pointInPolygon(probe, other.points) ? count + 1 : count;
    }, 0);
    return containmentDepth % 2 === 0;
  });
}

function hasRingInside(ringLoops: ReadonlyArray<Polyline>, root: Polyline): boolean {
  return ringLoops.some((ring) => {
    const probe = ring.points[0];
    return probe !== undefined && pointInPolygon(probe, root.points);
  });
}
