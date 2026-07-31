// chamfer-corner — flatten a path corner (ADR-272, DS-6).
//
// The exact operation: one vertex is replaced by the two setback points, so the
// result is straight-line geometry with no sampling and no tolerance. Nothing is
// approximated, which is why chamfer is the safer of the two corner operations on
// a part that has to fit.

import type { Vec2 } from '../../scene';
import type { SketchPath } from '../sketch-entity';
import { cornerSetback } from './corner-geometry';

/**
 * Chamfers the corner at `cornerIndex`, cutting `distanceMm` back along both legs.
 *
 * Returns null when the index is not an interior corner of the path, or the corner
 * cannot take that distance. On a closed path every vertex is a corner; on an open
 * one the two ends are not.
 */
export function chamferPathCorner(
  path: SketchPath,
  cornerIndex: number,
  distanceMm: number,
): SketchPath | null {
  const neighbours = cornerNeighbours(path, cornerIndex);
  if (neighbours === null) return null;
  const setback = cornerSetback(
    neighbours.previousMm,
    neighbours.cornerMm,
    neighbours.nextMm,
    distanceMm,
  );
  if (setback === null) return null;
  return {
    ...path,
    points: replaceVertex(path.points, cornerIndex, [setback.startMm, setback.endMm]),
  };
}

export type CornerNeighbours = {
  readonly previousMm: Vec2;
  readonly cornerMm: Vec2;
  readonly nextMm: Vec2;
};

/**
 * The three points that make the corner at `index`, or null when there is no
 * corner there. Wraps around on a closed path.
 */
export function cornerNeighbours(path: SketchPath, index: number): CornerNeighbours | null {
  const points = path.points;
  const count = points.length;
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  // A corner needs a segment on each side. An open path has none at its ends.
  if (!path.closed && (index === 0 || index === count - 1)) return null;
  if (count < 3) return null;
  const previous = points[(index - 1 + count) % count];
  const corner = points[index];
  const next = points[(index + 1) % count];
  if (previous === undefined || corner === undefined || next === undefined) return null;
  return { previousMm: previous, cornerMm: corner, nextMm: next };
}

export function replaceVertex(
  points: ReadonlyArray<Vec2>,
  index: number,
  replacement: ReadonlyArray<Vec2>,
): ReadonlyArray<Vec2> {
  return [...points.slice(0, index), ...replacement, ...points.slice(index + 1)];
}
