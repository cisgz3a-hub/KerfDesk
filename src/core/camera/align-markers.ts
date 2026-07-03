// Automatic camera alignment from engraved markers (ADR-109, camera v3). The
// pattern is four 2×2 checker patches inset from the bed corners — each patch
// center is a literal X-corner, so the proven checkerboard corner detector
// finds them. The ORIGIN (top-left) target is a PAIR of patches whose midpoint
// is the target point: the unique tight pair disambiguates camera rotation
// without any user click. Pure core: layout math + detection + homography.

import type { Vec2 } from '../scene';
import { refineCornerSubpixel, type GrayImage } from './corner-subpix';
import { type Mat3, type PointPair, solveHomography } from './homography';
import { findCornerCandidates } from './xcorner';

export type AlignMarkerLayout = {
  // Bed-mm target points, clockwise from the origin: TL, TR, BR, BL.
  readonly targets: readonly [Vec2, Vec2, Vec2, Vec2];
  readonly patchSquareMm: number;
  readonly originPairSeparationMm: number;
};

export type AlignMarkerOptions = {
  readonly insetMm?: number;
  readonly patchSquareMm?: number;
};

export type MarkerDetection =
  | { readonly kind: 'ok'; readonly imagePoints: readonly [Vec2, Vec2, Vec2, Vec2] }
  | { readonly kind: 'failed'; readonly reason: MarkerFailure };

export type MarkerFailure = 'too-few-markers' | 'ambiguous-origin' | 'degenerate';

// 10 mm cells keep the sub-pixel refinement window well inside one cell even
// on a low-resolution camera (~1.3 px/mm for a 640px frame over a 400mm bed);
// smaller cells let the window reach the patch edge and bias the corner.
const DEFAULT_PATCH_SQUARE_MM = 10;
// Inset clears the origin pair's outer patch edge (pair half-span + one
// square) with margin, so every patch lands fully on the bed.
const DEFAULT_INSET_MM = 35;
// Origin pair separation = 3 squares: patches (2 squares wide) do not touch
// and the pair still reads as one tight cluster against corner-to-corner
// marker distances.
const ORIGIN_PAIR_SEPARATION_SQUARES = 3;
// The candidate pool inspected for the marker constellation. The five marker
// corners dominate a cleared bed; a small surplus tolerates stray responses.
const CANDIDATE_POOL = 8;
// The origin pair must be this much tighter than any other candidate spacing.
const PAIR_DOMINANCE = 0.35;

/** The marker layout for a bed, shared by the pattern generator and the UI. */
export function alignMarkerLayout(
  bedWidthMm: number,
  bedHeightMm: number,
  options?: AlignMarkerOptions,
): AlignMarkerLayout {
  const inset = options?.insetMm ?? DEFAULT_INSET_MM;
  const square = options?.patchSquareMm ?? DEFAULT_PATCH_SQUARE_MM;
  return {
    targets: [
      { x: inset, y: inset },
      { x: bedWidthMm - inset, y: inset },
      { x: bedWidthMm - inset, y: bedHeightMm - inset },
      { x: inset, y: bedHeightMm - inset },
    ],
    patchSquareMm: square,
    originPairSeparationMm: ORIGIN_PAIR_SEPARATION_SQUARES * square,
  };
}

/**
 * Find the four marker points in a camera frame: five X-corners, of which the
 * unique tight pair is the origin (its midpoint is the target). Returns the
 * points clockwise from the origin, matching {@link AlignMarkerLayout}.targets.
 */
export function detectAlignMarkers(img: GrayImage): MarkerDetection {
  const pool = findCornerCandidates(img)
    .slice(0, CANDIDATE_POOL)
    .map((c) => refineCornerSubpixel(img, c));
  if (pool.length < 5) return { kind: 'failed', reason: 'too-few-markers' };
  const pair = findOriginPair(pool);
  if (pair === null) return { kind: 'failed', reason: 'ambiguous-origin' };
  const origin = midpoint(pool[pair.a], pool[pair.b]);
  if (origin === null) return { kind: 'failed', reason: 'ambiguous-origin' };
  const singles = pool.filter((_, index) => index !== pair.a && index !== pair.b).slice(0, 3);
  if (singles.length < 3) return { kind: 'failed', reason: 'too-few-markers' };
  return { kind: 'ok', imagePoints: orderClockwiseFromOrigin(origin, singles) };
}

/** Solve the image→bed homography for detected markers against the layout. */
export function solveMarkerAlignment(
  detection: Extract<MarkerDetection, { readonly kind: 'ok' }>,
  layout: AlignMarkerLayout,
):
  | { readonly kind: 'ok'; readonly homography: Mat3 }
  | { readonly kind: 'failed'; readonly reason: 'degenerate' } {
  const pairs: PointPair[] = detection.imagePoints.map((src, index) => ({
    src,
    // Both tuples are fixed length four; the index is always in range.
    dst: layout.targets[index] ?? { x: 0, y: 0 },
  }));
  const result = solveHomography(pairs);
  if (!result.ok) return { kind: 'failed', reason: 'degenerate' };
  return { kind: 'ok', homography: result.matrix };
}

type PairIndices = { readonly a: number; readonly b: number };

// The origin pair is the globally closest candidate pair, and it must be
// decisively tighter than any distance involving a third point.
function findOriginPair(pool: ReadonlyArray<Vec2>): PairIndices | null {
  let best: PairIndices | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let secondDist = Number.POSITIVE_INFINITY;
  for (let a = 0; a < pool.length; a += 1) {
    for (let b = a + 1; b < pool.length; b += 1) {
      const pa = pool[a];
      const pb = pool[b];
      if (pa === undefined || pb === undefined) continue;
      const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (dist < bestDist) {
        secondDist = bestDist;
        bestDist = dist;
        best = { a, b };
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    }
  }
  if (best === null) return null;
  return bestDist < PAIR_DOMINANCE * secondDist ? best : null;
}

function midpoint(a: Vec2 | undefined, b: Vec2 | undefined): Vec2 | null {
  if (a === undefined || b === undefined) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Clockwise in y-down image coordinates = ascending atan2 angle around the
// centroid. A physical camera never mirrors, so clockwise in the image is
// clockwise on the bed and the origin-first ordering matches the layout.
function orderClockwiseFromOrigin(
  origin: Vec2,
  singles: ReadonlyArray<Vec2>,
): readonly [Vec2, Vec2, Vec2, Vec2] {
  const all = [origin, ...singles];
  const cx = all.reduce((sum, p) => sum + p.x, 0) / all.length;
  const cy = all.reduce((sum, p) => sum + p.y, 0) / all.length;
  const sorted = [...all].sort(
    (p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx),
  );
  const start = sorted.findIndex((p) => p === origin);
  const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];
  // Exactly four points by construction; the fallback only satisfies the type.
  return [rotated[0] ?? origin, rotated[1] ?? origin, rotated[2] ?? origin, rotated[3] ?? origin];
}
