// Clips cut lines (open or closed polylines) to a clip region, keeping the
// pieces inside it in their original order and direction (ADR-358 Amendment
// 2). Clipper2's open-path clipping is not used: it reorders pieces and keeps
// a line lying exactly on the region's edge on some edges but not others.
// Here the region is a closed set: a line on its outline, within the 1 µm grid
// the region was built on, is inside. A closed ring cut open at its start is
// rejoined into one piece so the cut has no extra start point.

import type { PathsD } from 'clipper2-ts';
import type { Polyline, Vec2 } from '../../core/scene';

// The region's vertices sit on a 1 µm grid (SVG_CLIP_PRECISION_DECIMALS).
const ON_OUTLINE_MM = 1e-3;
const MIN_PIECE_MM = 1e-3;
const MAX_BANDS = 1024;
// Split parameters closer than this along one segment are the same split.
const CUT_EPSILON = 1e-12;

export type ClippedLine =
  | { readonly kind: 'inside' }
  | { readonly kind: 'pieces'; readonly pieces: ReadonlyArray<Polyline> };

export type RegionLineClipper = (points: ReadonlyArray<Vec2>, closed: boolean) => ClippedLine;

type RegionIndex = {
  readonly edges: Float64Array; // ax, ay, bx, by per outline edge
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  readonly bandHeight: number;
  readonly bands: ReadonlyArray<ReadonlyArray<number>>;
  readonly seen: Int32Array;
  readonly found: number[];
  mark: number;
};

const INSIDE: ClippedLine = { kind: 'inside' };
const NOTHING: ClippedLine = { kind: 'pieces', pieces: [] };

export function createRegionLineClipper(region: PathsD): RegionLineClipper {
  const index = indexRegion(region);
  return (points, closed) => clipLine(index, points, closed);
}

function clipLine(index: RegionIndex, points: ReadonlyArray<Vec2>, closed: boolean): ClippedLine {
  const path = closedPath(points, closed);
  const first = path[0];
  if (first === undefined || !overlapsRegion(index, path)) return NOTHING;
  if (path.length === 1) return inside(index, first) ? INSIDE : NOTHING;
  const traced = tracePieces(index, path);
  return traced.whole
    ? INSIDE
    : { kind: 'pieces', pieces: finishPieces(traced.pieces, path, closed) };
}

// Walks the path once, splitting each segment where it meets the outline and
// keeping the stretches whose midpoints lie inside.
function tracePieces(
  index: RegionIndex,
  path: ReadonlyArray<Vec2>,
): { readonly pieces: Vec2[][]; readonly whole: boolean } {
  const pieces: Vec2[][] = [];
  let current: Vec2[] | null = null;
  let whole = true;
  for (let segment = 0; segment + 1 < path.length; segment += 1) {
    const a = path[segment] as Vec2;
    const b = path[segment + 1] as Vec2;
    const cuts = crossings(index, a, b);
    for (let k = 0; k + 1 < cuts.length; k += 1) {
      const t0 = cuts[k] as number;
      const t1 = cuts[k + 1] as number;
      if (inside(index, lerp(a, b, (t0 + t1) / 2))) {
        current ??= [pointAt(a, b, t0)];
        current.push(pointAt(a, b, t1));
        continue;
      }
      whole = false;
      if (current !== null) pieces.push(current);
      current = null;
    }
  }
  if (current !== null) pieces.push(current);
  return { pieces, whole };
}

function closedPath(points: ReadonlyArray<Vec2>, closed: boolean): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points.at(-1);
  if (!closed || first === undefined || last === undefined || samePoint(first, last)) return points;
  return [...points, first];
}

// A closed ring whose start lies inside ends in the piece it began with.
function finishPieces(pieces: Vec2[][], path: ReadonlyArray<Vec2>, closed: boolean): Polyline[] {
  let joined = pieces;
  const head = pieces[0];
  const tail = pieces.at(-1);
  const start = path[0];
  const end = path.at(-1);
  if (
    closed &&
    pieces.length > 1 &&
    head !== undefined &&
    tail !== undefined &&
    start !== undefined &&
    end !== undefined &&
    head[0] === start &&
    tail.at(-1) === end
  ) {
    joined = [[...tail, ...head.slice(1)], ...pieces.slice(1, -1)];
  }
  return joined
    .filter((piece) => pieceLength(piece) >= MIN_PIECE_MM)
    .map((points) => ({ points, closed: false }));
}

// Split parameters along a→b where it meets the outline, from 0 to 1.
function crossings(index: RegionIndex, a: Vec2, b: Vec2): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return [0, 1];
  const interior: number[] = [];
  const minX = Math.min(a.x, b.x) - ON_OUTLINE_MM;
  const maxX = Math.max(a.x, b.x) + ON_OUTLINE_MM;
  const { edges } = index;
  for (const edge of candidateEdges(index, Math.min(a.y, b.y), Math.max(a.y, b.y))) {
    const e = edge * 4;
    const px = edges[e] as number;
    const qx = edges[e + 2] as number;
    if (Math.max(px, qx) < minX || Math.min(px, qx) > maxX) continue;
    edgeCrossings(a, { dx, dy, lengthSquared }, edges, e, interior);
  }
  interior.sort((left, right) => left - right);
  const cuts = [0];
  for (const cut of interior) {
    if (cut - (cuts.at(-1) as number) > CUT_EPSILON && 1 - cut > CUT_EPSILON) cuts.push(cut);
  }
  cuts.push(1);
  return cuts;
}

// The outline edge at `edges[e..e + 3]` (px, py, qx, qy) against a→b.
function edgeCrossings(
  a: Vec2,
  {
    dx,
    dy,
    lengthSquared,
  }: { readonly dx: number; readonly dy: number; readonly lengthSquared: number },
  edges: Float64Array,
  e: number,
  cuts: number[],
): void {
  const px = edges[e] as number;
  const py = edges[e + 1] as number;
  const ex = (edges[e + 2] as number) - px;
  const ey = (edges[e + 3] as number) - py;
  const wx = px - a.x;
  const wy = py - a.y;
  const denominator = dx * ey - dy * ex;
  if (Math.abs(denominator) > 1e-12 * Math.sqrt(lengthSquared * (ex * ex + ey * ey))) {
    const t = (wx * ey - wy * ex) / denominator;
    const u = (wx * dy - wy * dx) / denominator;
    if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t);
    return;
  }
  // Parallel: an edge along the line splits it where the shared stretch ends.
  if (Math.abs(wx * dy - wy * dx) / Math.sqrt(lengthSquared) > ON_OUTLINE_MM) return;
  const start = (wx * dx + wy * dy) / lengthSquared;
  const end = ((wx + ex) * dx + (wy + ey) * dy) / lengthSquared;
  if (start > 0 && start < 1) cuts.push(start);
  if (end > 0 && end < 1) cuts.push(end);
}

// Inside the region or on its outline. The region is normalised, so even-odd
// crossing parity decides membership.
function inside(index: RegionIndex, point: Vec2): boolean {
  const { bounds } = index;
  if (
    point.x < bounds.minX - ON_OUTLINE_MM ||
    point.x > bounds.maxX + ON_OUTLINE_MM ||
    point.y < bounds.minY - ON_OUTLINE_MM ||
    point.y > bounds.maxY + ON_OUTLINE_MM
  )
    return false;
  let parity = false;
  const { edges } = index;
  for (const edge of candidateEdges(index, point.y, point.y)) {
    const e = edge * 4;
    const px = edges[e] as number;
    const py = edges[e + 1] as number;
    const qx = edges[e + 2] as number;
    const qy = edges[e + 3] as number;
    if (onEdge(point, px, py, qx, qy)) return true;
    if (py > point.y !== qy > point.y && point.x < px + ((point.y - py) * (qx - px)) / (qy - py))
      parity = !parity;
  }
  return parity;
}

function onEdge(point: Vec2, px: number, py: number, qx: number, qy: number): boolean {
  if (point.x < Math.min(px, qx) - ON_OUTLINE_MM || point.x > Math.max(px, qx) + ON_OUTLINE_MM)
    return false;
  return segmentDistance(point, px, py, qx, qy) <= ON_OUTLINE_MM;
}

function segmentDistance(point: Vec2, px: number, py: number, qx: number, qy: number): number {
  const ex = qx - px;
  const ey = qy - py;
  const lengthSquared = ex * ex + ey * ey;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - px) * ex + (point.y - py) * ey) / lengthSquared));
  return Math.hypot(point.x - (px + t * ex), point.y - (py + t * ey));
}

function indexRegion(region: PathsD): RegionIndex {
  const coordinates: number[] = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of region) {
    for (let position = 0; position < ring.length; position += 1) {
      const a = ring[position] as Vec2;
      const b = ring[(position + 1) % ring.length] as Vec2;
      if (samePoint(a, b)) continue;
      coordinates.push(a.x, a.y, b.x, b.y);
      bounds.minX = Math.min(bounds.minX, a.x);
      bounds.minY = Math.min(bounds.minY, a.y);
      bounds.maxX = Math.max(bounds.maxX, a.x);
      bounds.maxY = Math.max(bounds.maxY, a.y);
    }
  }
  const count = coordinates.length / 4;
  const bandCount = Math.max(1, Math.min(MAX_BANDS, Math.ceil(Math.sqrt(count))));
  const height = (bounds.maxY - bounds.minY) / bandCount;
  const bandHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const bands: number[][] = Array.from({ length: bandCount }, () => []);
  const index: RegionIndex = {
    edges: Float64Array.from(coordinates),
    bounds,
    bandHeight,
    bands,
    seen: new Int32Array(count),
    found: [],
    mark: 0,
  };
  for (let edge = 0; edge < count; edge += 1) {
    const y0 = coordinates[edge * 4 + 1] as number;
    const y1 = coordinates[edge * 4 + 3] as number;
    const last = band(index, Math.max(y0, y1));
    for (let row = band(index, Math.min(y0, y1)); row <= last; row += 1) bands[row]?.push(edge);
  }
  return index;
}

// Every edge whose band overlaps [minY, maxY] widened by the outline tolerance,
// once each. The returned buffer is reused by the next query.
function candidateEdges(index: RegionIndex, minY: number, maxY: number): ReadonlyArray<number> {
  index.mark += 1;
  const found = index.found;
  found.length = 0;
  const last = band(index, maxY + ON_OUTLINE_MM);
  for (let row = band(index, minY - ON_OUTLINE_MM); row <= last; row += 1) {
    for (const edge of index.bands[row] ?? []) {
      if (index.seen[edge] === index.mark) continue;
      index.seen[edge] = index.mark;
      found.push(edge);
    }
  }
  return found;
}

function band(index: RegionIndex, y: number): number {
  const row = Math.floor((y - index.bounds.minY) / index.bandHeight);
  return Math.max(0, Math.min(index.bands.length - 1, row));
}

function overlapsRegion(index: RegionIndex, path: ReadonlyArray<Vec2>): boolean {
  const { bounds } = index;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of path) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return (
    maxX >= bounds.minX - ON_OUTLINE_MM &&
    minX <= bounds.maxX + ON_OUTLINE_MM &&
    maxY >= bounds.minY - ON_OUTLINE_MM &&
    minY <= bounds.maxY + ON_OUTLINE_MM
  );
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Segment ends stay the path's own points, so a ring's start is recognisable.
function pointAt(a: Vec2, b: Vec2, t: number): Vec2 {
  if (t === 0) return a;
  return t === 1 ? b : lerp(a, b, t);
}

function pieceLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let position = 1; position < points.length; position += 1) {
    const a = points[position - 1] as Vec2;
    const b = points[position] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
