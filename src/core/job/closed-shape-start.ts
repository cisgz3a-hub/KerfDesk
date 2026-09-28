// Where the optimizer starts each closed shape (LBG-C04, LightBurn's "Choose
// best starting point" and "Choose corners" in Optimization Settings).
//
// A closed contour starts and stops at the same point, and that point often
// shows a small mark. 'drawn' keeps the start the design gives it. 'nearest'
// lets the planner enter the shape at whichever vertex is nearest the head,
// which shortens travel. 'nearest-corner' only offers the shape's corners, so
// the mark lands where an edge already turns; a shape without one (a circle,
// an ellipse) falls back to its nearest vertex.
//
// This module only names the candidate vertices. The planners pick among them
// (segment-order.ts) and rotateClosedCutSegment moves the start. A segment
// that carries arc moves (ADR-432) only offers vertices its moves also end on,
// so rotating it keeps its arcs.

import type { ProjectOptimizationSettings, Vec2 } from '../scene';
import { arcRotatableVertices } from './cut-arc-moves';
import type { CutSegment } from './job';

export type ClosedShapeStart = ProjectOptimizationSettings['closedShapeStart'];

/** How far along the path either side of a vertex its direction is read. */
export const CORNER_WINDOW_MM = 0.05;
// A corner turns by at least 30 degrees: cos^2(30 deg) is exactly 0.75.
const CORNER_MAX_COS_SQUARED = 0.75;

/**
 * The vertex indices `segment` may start at under `policy`, ascending. Only
 * a closed segment under 'nearest' or 'nearest-corner' offers more than its
 * drawn start (0). Vertices with a non-finite coordinate are never offered.
 */
export function closedStartCandidates(segment: CutSegment, policy: ClosedShapeStart): number[] {
  const vertexCount = segment.polyline.length - 1;
  if (policy === 'drawn' || !segment.closed || vertexCount < 2) return [0];
  const allowed = startableVertices(segment, vertexCount);
  if (policy === 'nearest-corner') {
    const corners = closedPolylineCorners(segment.polyline).filter((index) => allowed[index]);
    if (corners.length > 0) return corners;
  }
  const candidates: number[] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    if (allowed[index] === true) candidates.push(index);
  }
  return candidates;
}

// Whether each vertex can take the start: finite, and for a segment carrying
// arcs also a move end. The drawn start always can.
function startableVertices(segment: CutSegment, vertexCount: number): boolean[] {
  const arcEnds = arcRotatableVertices(segment);
  const allowed: boolean[] = new Array<boolean>(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) {
    const point = segment.polyline[index] as Vec2;
    allowed[index] =
      index === 0 ||
      (Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        (arcEnds === null || arcEnds.has(index)));
  }
  return allowed;
}

/**
 * The corners of a closed polyline (its last point closing on its first):
 * vertices where the path turns by at least 30 degrees. The direction in and
 * out of each vertex is read over CORNER_WINDOW_MM of path, not one edge, so
 * a densely sampled curve, whose every vertex turns a little, has no corners,
 * while a tiny fillet on a sharp corner still reads as one. Linear: both
 * window ends only move forward as the vertex does.
 */
export function closedPolylineCorners(polyline: ReadonlyArray<Vec2>): number[] {
  const count = polyline.length - 1;
  if (count < 2) return [];
  const lengths = cumulativeLoopLengths(polyline, count);
  const total = lengths[count] as number;
  if (!(total > 2 * CORNER_WINDOW_MM)) return [];
  const along = (virtual: number): number => {
    const lap = Math.floor(virtual / count);
    return (lengths[virtual - lap * count] as number) + lap * total;
  };
  const vertex = (virtual: number): Vec2 =>
    polyline[virtual - Math.floor(virtual / count) * count] as Vec2;
  const corners: number[] = [];
  let back = -count;
  let ahead = 1;
  for (let index = 0; index < count; index += 1) {
    const here = along(index);
    while (back + 1 < index && here - along(back + 1) >= CORNER_WINDOW_MM) back += 1;
    if (ahead <= index) ahead = index + 1;
    while (ahead < index + count && along(ahead) - here < CORNER_WINDOW_MM) ahead += 1;
    if (back <= index - count || ahead >= index + count) continue;
    if (turnsSharply(vertex(back), polyline[index] as Vec2, vertex(ahead))) corners.push(index);
  }
  return corners;
}

// lengths[i] is the path length from vertex 0 to vertex i; lengths[count] is
// the whole loop, closing on vertex 0 itself.
function cumulativeLoopLengths(polyline: ReadonlyArray<Vec2>, count: number): number[] {
  const lengths = [0];
  let sum = 0;
  for (let index = 1; index <= count; index += 1) {
    const a = polyline[index - 1] as Vec2;
    const b = polyline[index % count] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    sum += Math.sqrt(dx * dx + dy * dy);
    lengths.push(sum);
  }
  return lengths;
}

// Exact IEEE arithmetic only (no trigonometry), so every platform agrees on
// which vertices are corners: the turn is at least 30 degrees when the
// directions' dot product is at most cos(30 deg) of their lengths' product.
function turnsSharply(from: Vec2, at: Vec2, to: Vec2): boolean {
  const ux = at.x - from.x;
  const uy = at.y - from.y;
  const vx = to.x - at.x;
  const vy = to.y - at.y;
  const dot = ux * vx + uy * vy;
  if (dot <= 0) return true;
  return dot * dot <= CORNER_MAX_COS_SQUARED * (ux * ux + uy * uy) * (vx * vx + vy * vy);
}

/**
 * The candidate nearest `cursor` for a closed segment, ties to the lowest
 * vertex index (so to the drawn start). Linear in the segment's vertices.
 */
export function nearestClosedStart(
  segment: CutSegment,
  cursor: Vec2,
  policy: ClosedShapeStart,
): number {
  let best = 0;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const index of closedStartCandidates(segment, policy)) {
    const point = segment.polyline[index] as Vec2;
    const dx = point.x - cursor.x;
    const dy = point.y - cursor.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = index;
    }
  }
  return best;
}
