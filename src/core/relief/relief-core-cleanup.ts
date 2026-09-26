// reliefCoreCleanup — the stock a relief roughing level's rings leave standing
// (ADR-289 Amendment 1). The rings step inward from the level's region
// boundary by the stepover. When the stepover is wider than the cutter radius
// (above 50%), the innermost ring can stop further from the region's centre
// than the cutter reaches, leaving a full-height core: a 6.35 mm end mill at
// 85% on a 20 mm square stops 4.6 mm from the centre and sweeps only 3.175 mm.
// Rings on an irregular region also leave cusps where an inset's sharp corner
// outruns the next ring's sweep.
//
// The pocket planner clears the same leftovers (pocket-paths.ts, ADR-098's
// pocket core coverage amendment) with a central ring bisected to the medial
// axis and a trace around whatever the actual cutter sweep still misses. This
// uses the same two passes, chosen for each piece of stock the rings leave
// rather than for each region. A piece gets the ring at its deepest inset (the
// region's own centre when the piece is its core) when that ring's sweep
// covers it, and a trace around it otherwise. A trace reaches one cutter
// radius into the piece, so whatever a thicker piece still holds is cleared
// the same way in the next round. Bisecting a small piece is far cheaper than
// bisecting a whole waterline region, and a region whose centre the rings
// already reach gets no central pass. A piece no thicker than twice the
// bisection tolerance is a hairline where two sweeps just meet, not stock
// worth a pass.
//
// Every added path lies inside the level's tool-centre region: stock the rings
// leave is at least a cutter radius inside its boundary, which ring 0's sweep
// covers, so no path leaves the region the dilated heightmap proved safe.

import { offsetClosedPolylinesWithRoundJoinsChecked } from '../geometry/kerf-offset';
import { insetContoursChecked, type OffsetLadder } from '../geometry/offset-ladder';
import {
  differenceClosedPolylinesChecked,
  normalizeClosedPolylineTreeEvenOddChecked,
  type NormalizedPolylineTreeNode,
} from '../geometry/polygon-difference';
import { roundStrokeOutline } from '../geometry/round-stroke-outline';
import type { Polyline } from '../scene';

// The pocket planner's bisection budget and tolerance: 24 halvings resolve any
// bed-sized span far below 0.01 mm, which also sets the thinnest stock that
// earns its own pass.
const RING_BISECT_ITERATIONS = 24;
const RING_BISECT_TOLERANCE_MM = 0.01;
// Each round clears one cutter radius deeper into what is left, so a level
// needs about (its thickest leftover / 2 / cutter radius) rounds: one up to a
// 100% stepover. The ring ladder's budget bounds pathological inputs here too.
const MAX_CLEANUP_ROUNDS = 4096;

export type ReliefCoreCleanup = {
  // Closed paths to cut after the level's regular rings, round by round.
  readonly paths: ReadonlyArray<Polyline>;
  // True when a sweep, subtraction or grouping failed, so the level may still
  // hold stock. Advisory only, like the ladder's own failure (rule 7).
  readonly offsetFailed: boolean;
  // True when stock remained after the last permitted round. Advisory only.
  readonly passLimited: boolean;
};

const NO_CLEANUP: ReliefCoreCleanup = { paths: [], offsetFailed: false, passLimited: false };

/** Paths that clear what one level's regular rings leave standing. `region` is
 * the level's tool-centre region, `ladder` its rings (ring k inset k * stepMm),
 * and `cutRadiusMm` the radius each ring clears. Empty whenever the stepover is
 * at most the cutter radius: neighbouring sweeps then overlap at every corner
 * and the innermost one reaches the centre. */
export function reliefCoreCleanup(
  region: ReadonlyArray<Polyline>,
  ladder: OffsetLadder,
  stepMm: number,
  cutRadiusMm: number,
): ReliefCoreCleanup {
  const rings = ladder.rings.flat();
  // A truncated ladder has already reported its failure or budget; it keeps
  // exactly its regular rings.
  if (!(stepMm > cutRadiusMm) || rings.length === 0 || ladder.capped || ladder.offsetFailed) {
    return NO_CLEANUP;
  }
  const uncut = uncutByRings(region, ladder, cutRadiusMm);
  if (uncut === null) return { ...NO_CLEANUP, offsetFailed: true };
  return clearStock(uncut, cutRadiusMm);
}

function clearStock(uncut: ReadonlyArray<Polyline>, cutRadiusMm: number): ReliefCoreCleanup {
  const paths: Polyline[] = [];
  let area = uncut;
  for (let round = 0; round < MAX_CLEANUP_ROUNDS; round += 1) {
    const stock = thickPieces(area);
    if (stock === null) {
      // Stock the engine cannot sort is traced once as it stands, and reported.
      return { paths: [...paths, ...area], offsetFailed: true, passLimited: false };
    }
    if (stock.length === 0) return { paths, offsetFailed: false, passLimited: false };
    const added = stock.flatMap((piece) => piecePaths(piece, cutRadiusMm));
    paths.push(...added);
    const left = uncutArea(stock.flat(), added, cutRadiusMm);
    if (left === null) return { paths, offsetFailed: true, passLimited: false };
    area = left;
  }
  const stock = thickPieces(area);
  return { paths, offsetFailed: stock === null, passLimited: (stock?.length ?? 0) > 0 };
}

// The ring at a piece's deepest inset when its sweep covers the whole piece,
// as it covers a core or a cusp; otherwise a trace around the piece.
function piecePaths(piece: ReadonlyArray<Polyline>, cutRadiusMm: number): ReadonlyArray<Polyline> {
  const centre = deepestRing(piece);
  // A piece deeper than one radius has boundary beyond its centre's reach.
  if (centre.ring.length > 0 && centre.insetMm <= cutRadiusMm) {
    const missed = uncutArea(piece, centre.ring, cutRadiusMm);
    const rest = missed === null ? null : thickPieces(missed);
    if (rest !== null && rest.length === 0) return centre.ring;
  }
  return piece;
}

// The part of the region no regular ring reaches. Ring 0 is the region's own
// boundary, whose sweep reaches exactly one cutter radius in, so the region
// inset by that radius stands in for it: a round-join inset follows the same
// arcs at the region's inner corners, and far fewer vertices go into the sweep
// union than the marching-squares boundary brings. The inset's chords can only
// keep a hairline of ring 0's sweep, which the thickness test drops.
function uncutByRings(
  region: ReadonlyArray<Polyline>,
  ladder: OffsetLadder,
  cutRadiusMm: number,
): ReadonlyArray<Polyline> | null {
  const interior = offsetClosedPolylinesWithRoundJoinsChecked(region, -cutRadiusMm);
  if (interior.kind === 'error') return null;
  const inner = ladder.rings.slice(1).flat();
  if (interior.value.length === 0 || inner.length === 0) return interior.value;
  return uncutArea(interior.value, inner, cutRadiusMm);
}

// The part of `area` a cutter of `radiusMm` riding `paths` does not reach.
function uncutArea(
  area: ReadonlyArray<Polyline>,
  paths: ReadonlyArray<Polyline>,
  radiusMm: number,
): ReadonlyArray<Polyline> | null {
  const swept = roundStrokeOutline(paths, 2 * radiusMm);
  if (swept === null) return null;
  const remaining = differenceClosedPolylinesChecked(area, swept);
  return remaining.kind === 'error' ? null : remaining.value;
}

// Each separate piece of `area` (its outer contour, then its holes) thicker
// than twice the tolerance; null when the engine cannot sort the area. A
// piece whose inset fails is still stock inside the region: it is kept.
function thickPieces(area: ReadonlyArray<Polyline>): ReadonlyArray<ReadonlyArray<Polyline>> | null {
  const topology = normalizeClosedPolylineTreeEvenOddChecked(area);
  if (topology.kind === 'error') return null;
  return solidRegions(topology.value).filter((contours) => {
    const inset = insetContoursChecked(contours, RING_BISECT_TOLERANCE_MM);
    return inset.offsetFailed || inset.contours.length > 0;
  });
}

// Each outer contour with its direct holes, as the pocket planner groups them.
function solidRegions(
  nodes: ReadonlyArray<NormalizedPolylineTreeNode>,
): ReadonlyArray<ReadonlyArray<Polyline>> {
  const regions = new Map<number, Polyline[]>();
  nodes.forEach((node, index) => {
    if (!node.isHole) regions.set(index, [node.contour]);
    else if (node.parentIndex !== null) regions.get(node.parentIndex)?.push(node.contour);
  });
  return [...regions.values()];
}

type DeepestRing = {
  readonly ring: ReadonlyArray<Polyline>;
  readonly insetMm: number;
};

// The ring at a piece's largest non-empty inset, bisected as the pocket
// planner bisects its core ring. No inset reaches past half the piece's
// narrower bounding-box side. A failed offset ends the search with the
// deepest ring found; with none, the piece is traced instead.
function deepestRing(contours: ReadonlyArray<Polyline>): DeepestRing {
  let low = 0;
  let high = halfNarrowerSideMm(contours) + RING_BISECT_TOLERANCE_MM;
  let best: ReadonlyArray<Polyline> = [];
  for (let i = 0; i < RING_BISECT_ITERATIONS && high - low > RING_BISECT_TOLERANCE_MM; i += 1) {
    const mid = (low + high) / 2;
    const inset = insetContoursChecked(contours, mid);
    if (inset.offsetFailed) break;
    if (inset.contours.length === 0) {
      high = mid;
    } else {
      low = mid;
      best = inset.contours;
    }
  }
  return { ring: best, insetMm: low };
}

function halfNarrowerSideMm(contours: ReadonlyArray<Polyline>): number {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of contours[0]?.points ?? []) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return Math.max(0, Math.min(maxX - minX, maxY - minY) / 2);
}
