// The edges of a polyline filed by grid cell, for the nearest-edge distance
// that measures how far Optimize Shapes (LBG-T22) moved an outline. Cells are
// about two edges long, so a search looks at a handful of edges; only cells an
// edge crosses are stored (an open-addressed hash table from cell to its list
// of edges), so a long thin outline across a large sheet costs no more than a
// small one.

import type { Vec2 } from '../../scene/scene-object';

const MIN_CELL_MM = 0.02;
// Keeps a cell's key (row * columns + column) a small integer.
const MAX_CELLS_PER_SIDE = 30000;
const EMPTY = -1;

export type EdgeGrid = {
  /** Edge k runs from (xs[k], ys[k]) to (xs[k + 1], ys[k + 1]). */
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly minX: number;
  readonly minY: number;
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  /** Hash table: the cell key in each slot (EMPTY when free), and its bucket. */
  readonly slotKeys: Int32Array;
  readonly slotBuckets: Int32Array;
  readonly mask: number;
  /** Edges of bucket b are edges[start[b] .. start[b + 1]). */
  readonly start: Int32Array;
  readonly edges: Int32Array;
};

type GridFrame = Pick<EdgeGrid, 'xs' | 'ys' | 'minX' | 'minY' | 'cell' | 'columns' | 'rows'>;

export function edgeGrid(points: ReadonlyArray<Vec2>, closed: boolean): EdgeGrid {
  const frame = gridFrame(points, closed);
  const pairs = edgeCells(frame);
  let size = 16;
  while (size < 2 * pairs.keys.length) size *= 2;
  const slotKeys = new Int32Array(size).fill(EMPTY);
  const slotBuckets = new Int32Array(size);
  const mask = size - 1;
  const counts: number[] = [];
  const bucketOfPair = new Int32Array(pairs.keys.length);
  for (let pair = 0; pair < pairs.keys.length; pair += 1) {
    const key = pairs.keys[pair] as number;
    let slot = hashSlot(key, mask);
    while (slotKeys[slot] !== EMPTY && slotKeys[slot] !== key) slot = (slot + 1) & mask;
    if (slotKeys[slot] === EMPTY) {
      slotKeys[slot] = key;
      slotBuckets[slot] = counts.length;
      counts.push(0);
    }
    const bucket = slotBuckets[slot] as number;
    counts[bucket] = (counts[bucket] as number) + 1;
    bucketOfPair[pair] = bucket;
  }
  const start = new Int32Array(counts.length + 1);
  for (let bucket = 0; bucket < counts.length; bucket += 1) {
    start[bucket + 1] = (start[bucket] as number) + (counts[bucket] as number);
  }
  const fill = start.slice(0, -1);
  const edges = new Int32Array(pairs.edges.length);
  for (let pair = 0; pair < pairs.edges.length; pair += 1) {
    const bucket = bucketOfPair[pair] as number;
    edges[fill[bucket] as number] = pairs.edges[pair] as number;
    fill[bucket] = (fill[bucket] as number) + 1;
  }
  return { ...frame, slotKeys, slotBuckets, mask, start, edges };
}

function gridFrame(points: ReadonlyArray<Vec2>, closed: boolean): GridFrame {
  const ring = closed && points.length > 1 ? [...points, points[0] as Vec2] : [...points];
  if (ring.length === 1) ring.push(ring[0] as Vec2);
  const xs = Float64Array.from(ring, (point) => point.x);
  const ys = Float64Array.from(ring, (point) => point.y);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let length = 0;
  for (let k = 0; k < xs.length; k += 1) {
    minX = Math.min(minX, xs[k] as number);
    minY = Math.min(minY, ys[k] as number);
    maxX = Math.max(maxX, xs[k] as number);
    maxY = Math.max(maxY, ys[k] as number);
    if (k > 0) {
      const dx = (xs[k] as number) - (xs[k - 1] as number);
      const dy = (ys[k] as number) - (ys[k - 1] as number);
      length += Math.sqrt(dx * dx + dy * dy);
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  const cell = Math.max(MIN_CELL_MM, (2 * length) / (xs.length - 1), extent / MAX_CELLS_PER_SIDE);
  const columns = Math.floor((maxX - minX) / cell) + 1;
  const rows = Math.floor((maxY - minY) / cell) + 1;
  return { xs, ys, minX, minY, cell, columns, rows };
}

function hashSlot(key: number, mask: number): number {
  return (Math.imul(key, 0x9e3779b1) >>> 7) & mask;
}

function bucketAt(grid: EdgeGrid, key: number): number {
  const { slotKeys, mask } = grid;
  let slot = hashSlot(key, mask);
  for (;;) {
    const stored = slotKeys[slot] as number;
    if (stored === key) return grid.slotBuckets[slot] as number;
    if (stored === EMPTY) return EMPTY;
    slot = (slot + 1) & mask;
  }
}

// Each cell an edge crosses, once per edge, as parallel lists of cell key and
// edge. A long edge is walked in cell-sized pieces so it does not fill its
// whole bounding box.
function edgeCells(frame: GridFrame): { keys: number[]; edges: number[] } {
  const { xs, ys, minX, minY, cell, columns } = frame;
  const keys: number[] = [];
  const edges: number[] = [];
  const seen: number[] = [];
  for (let edge = 0; edge + 1 < xs.length; edge += 1) {
    const ax = xs[edge] as number;
    const ay = ys[edge] as number;
    const dx = (xs[edge + 1] as number) - ax;
    const dy = (ys[edge + 1] as number) - ay;
    const pieces = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / cell));
    seen.length = 0;
    for (let piece = 0; piece < pieces; piece += 1) {
      const px = ax + (dx * piece) / pieces;
      const py = ay + (dy * piece) / pieces;
      const qx = ax + (dx * (piece + 1)) / pieces;
      const qy = ay + (dy * (piece + 1)) / pieces;
      const x0 = Math.floor(((px < qx ? px : qx) - minX) / cell);
      const x1 = Math.floor(((px < qx ? qx : px) - minX) / cell);
      const y0 = Math.floor(((py < qy ? py : qy) - minY) / cell);
      const y1 = Math.floor(((py < qy ? qy : py) - minY) / cell);
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const key = y * columns + x;
          // Pieces of one edge share cells at their joins; an edge crosses
          // few cells, so a short list finds the repeats.
          if (pieces > 1) {
            if (seen.includes(key)) continue;
            seen.push(key);
          }
          keys.push(key);
          edges.push(edge);
        }
      }
    }
  }
  return { keys, edges };
}

/** The distance from (px, py) to the nearest edge of the grid's polyline. */
export function nearestEdgeDistance(grid: EdgeGrid, px: number, py: number): number {
  const { cell, columns, rows } = grid;
  const cx = Math.floor((px - grid.minX) / cell);
  const cy = Math.floor((py - grid.minY) / cell);
  // How far the point is from the nearest side of its own cell.
  const fx = (px - grid.minX) / cell - cx;
  const fy = (py - grid.minY) / cell - cy;
  const margin = Math.max(0, Math.min(fx, 1 - fx, fy, 1 - fy)) * cell;
  const maxRing = Math.max(columns, rows) + Math.max(Math.abs(cx), Math.abs(cy));
  let bestSq = Infinity;
  for (let ring = 0; ring <= maxRing; ring += 1) {
    // Every cell of this ring or beyond is at least (ring - 1) cells and the margin away.
    const reach = (ring - 1) * cell + margin;
    if (ring > 0 && reach > 0 && bestSq <= reach * reach) break;
    bestSq = Math.min(bestSq, ringDistanceSq(grid, cx, cy, ring, px, py));
  }
  return bestSq === Infinity ? 0 : Math.sqrt(bestSq);
}

// The nearest edge filed in the square ring of cells `ring` cells out from
// (cx, cy), as a squared distance (Infinity when those cells are empty).
function ringDistanceSq(
  grid: EdgeGrid,
  cx: number,
  cy: number,
  ring: number,
  px: number,
  py: number,
): number {
  const { columns, rows } = grid;
  let bestSq = Infinity;
  const yLow = Math.max(0, cy - ring);
  const yHigh = Math.min(rows - 1, cy + ring);
  for (let y = yLow; y <= yHigh; y += 1) {
    const step = y === cy - ring || y === cy + ring ? 1 : Math.max(1, 2 * ring);
    for (let x = cx - ring; x <= cx + ring; x += step) {
      if (x < 0 || x >= columns) continue;
      const bucket = bucketAt(grid, y * columns + x);
      if (bucket !== EMPTY) bestSq = Math.min(bestSq, bucketDistanceSq(grid, bucket, px, py));
    }
  }
  return bestSq;
}

function bucketDistanceSq(grid: EdgeGrid, bucket: number, px: number, py: number): number {
  const { xs, ys, start, edges } = grid;
  let best = Infinity;
  const end = start[bucket + 1] as number;
  for (let at = start[bucket] as number; at < end; at += 1) {
    const edge = edges[at] as number;
    const ax = xs[edge] as number;
    const ay = ys[edge] as number;
    const dx = (xs[edge + 1] as number) - ax;
    const dy = (ys[edge + 1] as number) - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - (ax + dx * t);
    const ey = py - (ay + dy * t);
    const distanceSq = ex * ex + ey * ey;
    if (distanceSq < best) best = distanceSq;
  }
  return best;
}
