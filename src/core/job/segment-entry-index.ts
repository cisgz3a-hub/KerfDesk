// Uniform-grid nearest-entry lookup for the travel optimizer.
//
// WHY: nearestNeighborOrderFrom picked each next segment by scanning every
// remaining segment, so ordering n segments cost O(n^2) distance tests. That is
// the cost that forced MAX_NEAREST_NEIGHBOR_SEGMENTS, and the cap silently
// disables optimization for exactly the inputs that need it most - traced
// artwork, which routinely exceeds it.
//
// The grid buckets entry points by cell and searches outward in Chebyshev
// rings, stopping as soon as the best candidate found is provably closer than
// anything an unscanned cell could hold.
//
// DETERMINISM (PROJECT.md non-negotiable #5): the result must be the SAME pick
// the linear scan made, not merely an equally-near one. The linear scan kept
// the first candidate with a strictly smaller squared distance, visiting
// segments in ascending index and, within a segment, the forward entry before
// the reversed one. That is exactly a lexicographic minimum over
// (distanceSquared, segmentIndex, reverse). This module reproduces that
// comparator, so ties resolve identically and G-code stays byte-identical.
// A closed segment may also offer other start vertices (LBG-C04); the fourth
// key, vertexIndex (absent = 0, the drawn start), breaks their exact ties, so
// the drawn start wins a tie and entries without one compare as before.

import type { Vec2 } from '../scene';

export type SegmentEntry = {
  readonly point: Vec2;
  readonly segmentIndex: number;
  readonly reverse: boolean;
  /** The closed polyline vertex this entry starts at; absent means 0. */
  readonly vertexIndex?: number;
};

// `isAvailable` must be monotone: once a segment is unavailable it stays so.
// Both optimizer loops only ever retire segments, which lets the query drop
// retired entries as it meets them. A closed segment can bring one entry per
// vertex, so without that every later query near a placed shape would rescan
// its dead vertices, and ordering would stop being linear-ish in vertex count.
export type NearestEntryQuery = (
  cursor: Vec2,
  isAvailable: (segmentIndex: number) => boolean,
) => SegmentEntry | null;

// Keeps each cell near a handful of distinct points without letting the grid itself
// dominate memory on large inputs.
const TARGET_POINTS_PER_CELL = 2;
const MAX_GRID_SIDE = 512;

export function createNearestEntryQuery(entries: ReadonlyArray<SegmentEntry>): NearestEntryQuery {
  const grid = buildGrid(entries);
  if (grid === null) return linearQuery(entries);
  return (cursor, isAvailable) => gridNearest(grid, cursor, isAvailable);
}

type EntryPoint = {
  readonly point: Vec2;
  readonly entries: SegmentEntry[];
  next: number;
};

type Grid = {
  readonly points: ReadonlyArray<EntryPoint>;
  // Mutable: exhausted point queues are compacted out as queries meet them.
  readonly cells: ReadonlyArray<number[]>;
  readonly minX: number;
  readonly minY: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cols: number;
  readonly rows: number;
};

// Returns null when a grid cannot be trusted - no entries, or any non-finite
// coordinate, which would corrupt every cell index. The caller then falls back
// to the exhaustive scan, which is always correct.
function buildGrid(entries: ReadonlyArray<SegmentEntry>): Grid | null {
  if (entries.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const byX = new Map<number, Map<number, EntryPoint>>();
  const points: EntryPoint[] = [];
  for (const entry of entries) {
    const { x, y } = entry.point;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    let byY = byX.get(x);
    if (byY === undefined) {
      byY = new Map();
      byX.set(x, byY);
    }
    let point = byY.get(y);
    if (point === undefined) {
      point = { point: entry.point, entries: [], next: 0 };
      byY.set(y, point);
      points.push(point);
    }
    point.entries.push(entry);
  }
  // Exact coordinates only: no rounding, merging geometry or removing cuts.
  // Every entry at a point has the same distance from any cursor, so only its
  // first available tie winner can win a query. Stable sorting retains the
  // original entry identity when every tie key is equal. Retirement advances
  // each queue entry at most once instead of rescanning all coincident cuts.
  for (const point of points) point.entries.sort(compareEntryTies);
  const side = Math.min(
    MAX_GRID_SIDE,
    Math.max(1, Math.ceil(Math.sqrt(points.length / TARGET_POINTS_PER_CELL))),
  );
  // A collapsed axis has one occupied cell, not a row of empty cells whose
  // subnormal boundaries would keep the search radius at zero. Retain a
  // positive divisor for indexing, including underflowing nonzero extents.
  const cols = maxX === minX ? 1 : side;
  const rows = maxY === minY ? 1 : side;
  const cellWidth = Math.max((maxX - minX) / cols, Number.MIN_VALUE);
  const cellHeight = Math.max((maxY - minY) / rows, Number.MIN_VALUE);
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  for (const [i, entry] of points.entries()) {
    const cx = clampIndex(Math.floor((entry.point.x - minX) / cellWidth), cols);
    const cy = clampIndex(Math.floor((entry.point.y - minY) / cellHeight), rows);
    cells[cy * cols + cx]?.push(i);
  }
  return { points, cells, minX, minY, cellWidth, cellHeight, cols, rows };
}

function clampIndex(value: number, side: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(side - 1, Math.max(0, value));
}

function linearQuery(entries: ReadonlyArray<SegmentEntry>): NearestEntryQuery {
  const live = [...entries];
  return (cursor, isAvailable) => {
    let best: SegmentEntry | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    let kept = 0;
    for (const entry of live) {
      if (!isAvailable(entry.segmentIndex)) continue;
      live[kept] = entry;
      kept += 1;
      const distSq = distanceSquared(cursor, entry.point);
      if (isBetter(distSq, entry, bestDistSq, best)) {
        bestDistSq = distSq;
        best = entry;
      }
    }
    live.length = kept;
    return best;
  };
}

// The comparator the linear scan implied. Strictly-smaller distance wins;
// on an exact tie the lower segment index wins, and within one segment the
// forward entry wins - the order the old scan visited them in - then the lower
// start vertex, so a closed segment's drawn start wins its own ties.
function isBetter(
  distSq: number,
  candidate: SegmentEntry,
  bestDistSq: number,
  best: SegmentEntry | null,
): boolean {
  // A NaN distance must never win. The scan this replaces used `distSq <
  // bestDistSq`, which is false for NaN in both directions, so a NaN candidate
  // was silently passed over. Without this guard the first NaN entry becomes
  // "best" and then no real candidate can displace it, because every later
  // comparison against NaN is also false.
  if (!Number.isFinite(distSq)) return false;
  if (best === null) return true;
  if (distSq !== bestDistSq) return distSq < bestDistSq;
  return compareEntryTies(candidate, best) < 0;
}

function compareEntryTies(a: SegmentEntry, b: SegmentEntry): number {
  if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
  if (a.reverse !== b.reverse) return a.reverse ? 1 : -1;
  return (a.vertexIndex ?? 0) - (b.vertexIndex ?? 0);
}

function firstAvailable(
  point: EntryPoint,
  isAvailable: (segmentIndex: number) => boolean,
): SegmentEntry | undefined {
  while (point.next < point.entries.length) {
    const entry = point.entries[point.next];
    if (entry !== undefined && isAvailable(entry.segmentIndex)) return entry;
    point.next += 1;
  }
  return undefined;
}

function gridNearest(
  grid: Grid,
  cursor: Vec2,
  isAvailable: (segmentIndex: number) => boolean,
): SegmentEntry | null {
  const cx = clampIndex(Math.floor((cursor.x - grid.minX) / grid.cellWidth), grid.cols);
  const cy = clampIndex(Math.floor((cursor.y - grid.minY) / grid.cellHeight), grid.rows);
  let best: SegmentEntry | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  const maxRing = Math.max(cx, grid.cols - 1 - cx, cy, grid.rows - 1 - cy);
  for (let ring = 0; ring <= maxRing; ring += 1) {
    for (const cellIndex of ringCells(grid, cx, cy, ring)) {
      const cell = grid.cells[cellIndex];
      if (cell === undefined) continue;
      let kept = 0;
      for (const pointIndex of cell) {
        const point = grid.points[pointIndex];
        if (point === undefined) continue;
        const entry = firstAvailable(point, isAvailable);
        if (entry === undefined) continue;
        cell[kept] = pointIndex;
        kept += 1;
        const distSq = distanceSquared(cursor, entry.point);
        if (isBetter(distSq, entry, bestDistSq, best)) {
          bestDistSq = distSq;
          best = entry;
        }
      }
      cell.length = kept;
    }
    // Everything not yet scanned lies outside the box of scanned cells, so it
    // is at least `safeRadius` away. Once the best hit is nearer than that, no
    // later ring can beat it. Equality must keep searching: a boundary entry
    // can still win the segment-index or forward-direction tie-break.
    if (best !== null && bestDistSq < safeRadiusSquared(grid, cursor, cx, cy, ring)) return best;
  }
  return best;
}

// Lower bound on distance to any unsearched cell. A side already at the grid
// edge cannot hide another entry, so it contributes Infinity, not a zero bound.
// Once every cell is covered the bound is Infinity. Negative distances mean
// the cursor is outside an unsearched side; zero conservatively keeps searching.
function safeRadiusSquared(grid: Grid, cursor: Vec2, cx: number, cy: number, ring: number): number {
  const x0 = grid.minX + (cx - ring) * grid.cellWidth;
  const x1 = grid.minX + (cx + ring + 1) * grid.cellWidth;
  const y0 = grid.minY + (cy - ring) * grid.cellHeight;
  const y1 = grid.minY + (cy + ring + 1) * grid.cellHeight;
  const radius = Math.max(
    0,
    Math.min(
      cx - ring > 0 ? cursor.x - x0 : Infinity,
      cx + ring < grid.cols - 1 ? x1 - cursor.x : Infinity,
      cy - ring > 0 ? cursor.y - y0 : Infinity,
      cy + ring < grid.rows - 1 ? y1 - cursor.y : Infinity,
    ),
  );
  return radius * radius;
}

function ringCells(grid: Grid, cx: number, cy: number, ring: number): number[] {
  const out: number[] = [];
  const loX = cx - ring;
  const hiX = cx + ring;
  const loY = cy - ring;
  const hiY = cy + ring;
  for (let y = loY; y <= hiY; y += 1) {
    if (y < 0 || y >= grid.rows) continue;
    const edgeRow = y === loY || y === hiY;
    for (let x = loX; x <= hiX; x += 1) {
      if (x < 0 || x >= grid.cols) continue;
      // Interior cells were covered by an earlier ring.
      if (!edgeRow && x !== loX && x !== hiX) continue;
      out.push(y * grid.cols + x);
    }
  }
  return out;
}

function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}
