// pocketFreedIslands — the islands a pocket's own wall ring cuts all the way
// round (CNC audit v3 N3-P1-1, ADR-106 Amendment 3).
//
// An island is material a pocket region holds as a hole: the centre panel of a
// frame, or the counter of an "O". Every pocket strategy (offset, raster,
// adaptive and rest) ends on the finishing ring, which follows the edge of the
// region the bit centre can reach: the region inset by the bit radius. Where
// that centre region has a HOLE, the ring closes a loop round the material
// inside it, so at the stock bottom that material is a separate piece. Pockets
// take no holding tabs (ADR-258), so nothing holds it.
//
// Two islands closer together than the bit share one centre-region hole: the
// strip between them stays, and they come free as one piece. An island the bit
// cannot get all the way round (a gap to the wall narrower than the bit) leaves
// no hole and stays attached, so it is not reported.
//
// The region is read even-odd, as the planner reads it. A failed offset says
// nothing about the centre region, so it falls back to the region's own holes:
// every island, an over-report rather than a silent miss.

import { insetContoursChecked } from '../geometry/offset-ladder';
import { pointInPolygon } from '../geometry/point-in-polygon';
import {
  normalizeClosedPolylineTreeEvenOddChecked,
  type NormalizedPolylineTreeNode,
} from '../geometry/polygon-difference';
import type { Polyline, Vec2 } from '../scene';

export type FreedIsland = {
  /** Width and height of the material that comes free, mm. */
  readonly widthMm: number;
  readonly heightMm: number;
  /** Centre of that material's box, in the polylines' coordinates. */
  readonly centre: Vec2;
};

const MIN_CLOSED_POINTS = 3;

/** Islands the pocket's wall ring encircles; empty when nothing is enclosed. */
export function pocketFreedIslands(
  polylines: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
): ReadonlyArray<FreedIsland> {
  const closed = polylines.filter(
    (polyline) => polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS,
  );
  if (closed.length < 2) return [];
  const region = normalizeClosedPolylineTreeEvenOddChecked(closed);
  if (region.kind === 'error') return [];
  const islands = holes(region.value);
  if (islands.length === 0) return [];
  if (!(toolDiameterMm > 0)) return islands.map((island) => freedPiece([island]));
  const centre = insetContoursChecked(closed, toolDiameterMm / 2);
  if (centre.offsetFailed) return islands.map((island) => freedPiece([island]));
  const centreTree = normalizeClosedPolylineTreeEvenOddChecked(centre.contours);
  if (centreTree.kind === 'error') return islands.map((island) => freedPiece([island]));
  const pieces: FreedIsland[] = [];
  for (const loop of holes(centreTree.value)) {
    const inside = islands.filter((island) => encloses(loop, island));
    if (inside.length > 0) pieces.push(freedPiece(inside));
  }
  return pieces;
}

function holes(nodes: ReadonlyArray<NormalizedPolylineTreeNode>): Polyline[] {
  return nodes.filter((node) => node.isHole).map((node) => node.contour);
}

// An island lies inside a centre-region hole, or wholly outside it: the hole
// is the island grown by the bit radius, so one vertex decides.
function encloses(loop: Polyline, island: Polyline): boolean {
  const probe = island.points[0];
  return probe !== undefined && pointInPolygon(probe, loop.points);
}

function freedPiece(islands: ReadonlyArray<Polyline>): FreedIsland {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const island of islands)
    for (const point of island.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  return {
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}
