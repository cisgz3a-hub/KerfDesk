// ADR-140 Amendment 1: which finishing toolpaths roughing never reached.
//
// ADR-140 cuts the finishing contour in one full-depth pass because the
// roughing passes already cleared all but the allowance beside the wall. A
// hole, slot or neck between one cutter width and a cutter width plus twice
// the allowance loses its roughing path but keeps its finishing path, so the
// finishing cutter would enter solid stock there at full depth. Beside a
// roughed wall the finishing path is the allowance away from a roughing path;
// a point farther than one cutter radius plus the allowance from every
// roughing path of its part was never roughed.

import type { Polyline, Vec2 } from '../scene';

type Segment = { readonly a: Vec2; readonly b: Vec2 };

const MIN_CELL_MM = 0.05;

export type RoughingReach = {
  /** True when every point of the toolpath is within reach of roughing. */
  readonly covers: (toolpath: Polyline) => boolean;
};

export function roughingReach(
  roughingToolpaths: ReadonlyArray<Polyline>,
  reachMm: number,
): RoughingReach {
  const cellMm = Math.max(MIN_CELL_MM, reachMm);
  const grid = new Map<string, Segment[]>();
  for (const polyline of roughingToolpaths) {
    for (const segment of polylineSegments(polyline)) insertSegment(grid, cellMm, segment);
  }
  const reached = (point: Vec2): boolean => withinReach(grid, cellMm, point, reachMm);
  return {
    covers: (toolpath) =>
      polylineSegments(toolpath).every((segment) =>
        segmentSamples(segment, cellMm / 2).every(reached),
      ),
  };
}

function polylineSegments(polyline: Polyline): ReadonlyArray<Segment> {
  const { points } = polyline;
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) segments.push({ a, b });
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (polyline.closed && first !== undefined && last !== undefined && points.length > 2) {
    segments.push({ a: last, b: first });
  }
  if (segments.length === 0 && first !== undefined) segments.push({ a: first, b: first });
  return segments;
}

// The segment's end points plus interior points no farther apart than `stepMm`.
function segmentSamples(segment: Segment, stepMm: number): ReadonlyArray<Vec2> {
  const { a, b } = segment;
  const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stepMm));
  const samples: Vec2[] = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return samples;
}

// Files the segment under every cell it passes through. It goes in one cell
// long piece at a time, so a long diagonal edge does not fill its whole
// bounding box.
function insertSegment(grid: Map<string, Segment[]>, cellMm: number, segment: Segment): void {
  const keys = new Set<string>();
  const samples = segmentSamples(segment, cellMm);
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1];
    const to = samples[index];
    if (from !== undefined && to !== undefined) addBoxKeys(keys, cellMm, from, to);
  }
  for (const key of keys) {
    const bucket = grid.get(key);
    if (bucket === undefined) grid.set(key, [segment]);
    else bucket.push(segment);
  }
}

function addBoxKeys(keys: Set<string>, cellMm: number, from: Vec2, to: Vec2): void {
  const minX = cellIndex(Math.min(from.x, to.x), cellMm);
  const maxX = cellIndex(Math.max(from.x, to.x), cellMm);
  const minY = cellIndex(Math.min(from.y, to.y), cellMm);
  const maxY = cellIndex(Math.max(from.y, to.y), cellMm);
  for (let cy = minY; cy <= maxY; cy += 1) {
    for (let cx = minX; cx <= maxX; cx += 1) keys.add(`${String(cx)},${String(cy)}`);
  }
}

// A cell is one reach wide, so every segment within reach of the point touches
// the point's cell or one of its eight neighbours.
function withinReach(
  grid: ReadonlyMap<string, ReadonlyArray<Segment>>,
  cellMm: number,
  point: Vec2,
  reachMm: number,
): boolean {
  const cx = cellIndex(point.x, cellMm);
  const cy = cellIndex(point.y, cellMm);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const bucket = grid.get(`${String(cx + dx)},${String(cy + dy)}`) ?? [];
      if (bucket.some((segment) => distanceToSegment(point, segment) <= reachMm)) return true;
    }
  }
  return false;
}

function cellIndex(value: number, cellMm: number): number {
  return Math.floor(value / cellMm);
}

function distanceToSegment(point: Vec2, segment: Segment): number {
  const { a, b } = segment;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}
