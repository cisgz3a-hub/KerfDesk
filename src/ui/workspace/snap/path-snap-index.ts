// path-snap-index — lazily built, cached spatial indexes of one path's snap
// geometry, in the path's local coordinates.
//
// Cached by the ColoredPath object itself (a WeakMap), which is immutable: a
// move, rotate or scale replaces only the owning object's transform and keeps
// every path, so the index survives; an edit replaces only the edited path, and
// a discarded path takes its index with it. Big traced drawings therefore pay
// the build once — on the first pointer move that needs it — not per move.
//
// The segment index serves the intersection snap. It is built from the path's
// flattened polylines (the outline actually drawn) and only when intersections
// are switched on.

import type { ColoredPath } from '../../../core/scene';
import { buildBoxGrid, buildPointGrid, type CellGrid } from './cell-grid';
import { pathSnapPoints, type PathSnapPoints } from './path-snap-points';

export type PathPointIndex = PathSnapPoints & { readonly grid: CellGrid };

export type PathSegmentIndex = {
  readonly count: number;
  // x1, y1, x2, y2 per segment.
  readonly coords: Float64Array;
  readonly subpaths: Int32Array;
  readonly grid: CellGrid;
  // True when polyline i is curve i's outline, so a moving curve subpath can
  // be matched to its own segments. When not, a node drag drops the whole path.
  readonly alignedWithCurves: boolean;
};

const pointIndexes = new WeakMap<ColoredPath, PathPointIndex>();
const segmentIndexes = new WeakMap<ColoredPath, PathSegmentIndex>();

export function pathPointIndex(path: ColoredPath): PathPointIndex {
  const cached = pointIndexes.get(path);
  if (cached !== undefined) return cached;
  const points = pathSnapPoints(path);
  const index = { ...points, grid: buildPointGrid(points.xs, points.ys, points.count) };
  pointIndexes.set(path, index);
  return index;
}

export function pathSegmentIndex(path: ColoredPath): PathSegmentIndex {
  const cached = segmentIndexes.get(path);
  if (cached !== undefined) return cached;
  const index = buildSegmentIndex(path);
  segmentIndexes.set(path, index);
  return index;
}

function buildSegmentIndex(path: ColoredPath): PathSegmentIndex {
  const coords: number[] = [];
  const subpaths: number[] = [];
  path.polylines.forEach((polyline, subpath) => {
    const points = polyline.points;
    const count = points.length;
    const closing = polyline.closed && count > 2 ? count : count - 1;
    for (let index = 0; index < closing; index += 1) {
      const from = points[index];
      const to = points[(index + 1) % count];
      if (from === undefined || to === undefined) continue;
      if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) continue;
      if (from.x === to.x && from.y === to.y) continue;
      coords.push(from.x, from.y, to.x, to.y);
      subpaths.push(subpath);
    }
  });
  const count = subpaths.length;
  const packed = Float64Array.from(coords);
  return {
    count,
    coords: packed,
    subpaths: Int32Array.from(subpaths),
    grid: buildBoxGrid(segmentBoxes(packed, count), count),
    alignedWithCurves: path.curves === undefined || path.curves.length === path.polylines.length,
  };
}

function segmentBoxes(coords: Float64Array, count: number): Float64Array {
  const boxes = new Float64Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const x1 = coords[i * 4] ?? 0;
    const y1 = coords[i * 4 + 1] ?? 0;
    const x2 = coords[i * 4 + 2] ?? 0;
    const y2 = coords[i * 4 + 3] ?? 0;
    boxes[i * 4] = Math.min(x1, x2);
    boxes[i * 4 + 1] = Math.min(y1, y2);
    boxes[i * 4 + 2] = Math.max(x1, x2);
    boxes[i * 4 + 3] = Math.max(y1, y2);
  }
  return boxes;
}
