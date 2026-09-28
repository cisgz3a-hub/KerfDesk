// polylineStaysInside — whether a polyline lies wholly inside a region given
// as closed contours (even-odd, as a union's outers and holes are), never
// crossing or touching their boundary. Touching counts as leaving, so a doubt
// answers no. The contours' edges are bucketed on a grid so a long path
// against a detailed region stays fast.

import type { Vec2 } from '../scene';
import { pointInPolygon } from './point-in-polygon';

// The grid has at most this many buckets along its longer side.
const GRID_BUCKETS = 64;

type Edge = { readonly a: Vec2; readonly b: Vec2 };

type EdgeGrid = {
  readonly minX: number;
  readonly minY: number;
  readonly cellMm: number;
  readonly columns: number;
  readonly rows: number;
  readonly buckets: ReadonlyArray<ReadonlyArray<Edge>>;
};

export function polylineStaysInside(
  path: ReadonlyArray<Vec2>,
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
): boolean {
  const first = path[0];
  if (first === undefined) return false;
  if (contours.filter((contour) => pointInPolygon(first, contour)).length % 2 === 0) return false;
  const grid = edgeGrid(contours);
  if (grid === null) return false;
  // A single point still has to keep off the boundary.
  const last = path.length === 1 ? 1 : path.length - 1;
  for (let index = 0; index < last; index += 1) {
    const a = path[index] as Vec2;
    const b = path[index + 1] ?? a;
    if (touchesAnEdge(grid, a, b)) return false;
  }
  return true;
}

function edgeGrid(contours: ReadonlyArray<ReadonlyArray<Vec2>>): EdgeGrid | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const contour of contours)
    for (const point of contour) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  if (!Number.isFinite(minX)) return null;
  const span = Math.max(maxX - minX, maxY - minY);
  const cellMm = span > 0 ? span / GRID_BUCKETS : 1;
  const columns = Math.floor((maxX - minX) / cellMm) + 1;
  const rows = Math.floor((maxY - minY) / cellMm) + 1;
  const buckets: Edge[][] = Array.from({ length: columns * rows }, () => []);
  const grid = { minX, minY, cellMm, columns, rows, buckets };
  for (const contour of contours) {
    contour.forEach((a, index) => {
      const b = contour[(index + 1) % contour.length] as Vec2;
      forBuckets(grid, a, b, (bucket) => {
        bucket.push({ a, b });
        return false;
      });
    });
  }
  return grid;
}

// Visits every bucket the segment's bounding box overlaps, clamped to the
// grid, until a visit answers true.
function forBuckets<T>(
  grid: EdgeGrid & { readonly buckets: ReadonlyArray<T> },
  a: Vec2,
  b: Vec2,
  visit: (bucket: T) => boolean,
): boolean {
  const column = (x: number): number =>
    Math.min(grid.columns - 1, Math.max(0, Math.floor((x - grid.minX) / grid.cellMm)));
  const row = (y: number): number =>
    Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.minY) / grid.cellMm)));
  for (let j = row(Math.min(a.y, b.y)); j <= row(Math.max(a.y, b.y)); j += 1) {
    for (let i = column(Math.min(a.x, b.x)); i <= column(Math.max(a.x, b.x)); i += 1) {
      if (visit(grid.buckets[j * grid.columns + i] as T)) return true;
    }
  }
  return false;
}

function touchesAnEdge(grid: EdgeGrid, a: Vec2, b: Vec2): boolean {
  return forBuckets(grid, a, b, (bucket) => bucket.some((edge) => touches(a, b, edge.a, edge.b)));
}

// Segments ab and cd share a point: they cross, touch, or overlap along one
// line.
function touches(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)) {
    return false;
  }
  if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) {
    return false;
  }
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  // On one line with overlapping boxes: they overlap. (A zero-length edge
  // off the path's line falls through and fails the second test.)
  if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) return true;
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
