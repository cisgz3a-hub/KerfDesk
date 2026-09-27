// Path pieces and their uniform-grid index for the minimum-feature check
// (ADR-433). Every path segment is split into pieces no longer than twice the
// search radius (short enough that one long edge does not join every feature
// along it into one), and the grid cell is at least the radius, so every
// piece within the radius of another lies in a small block of cells around
// it. Stored in typed arrays (the grid as compressed rows): a dense traced
// job has hundreds of thousands of pieces.

import type { Vec2 } from '../scene';
import type { MinFeatureWorkMeter } from './feature-budget';
import { StackedOutlines } from './stacked-outlines';

export type MinFeaturePath = {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export type PieceIndex = {
  readonly count: number;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  /** Arc length along the owning path at the piece start. */
  readonly s0: Float64Array;
  readonly path: Int32Array;
  /** First piece of each path; pieces are stored path by path. */
  readonly pathStart: Int32Array;
  readonly pathClosed: ReadonlyArray<boolean>;
  readonly pathLength: Float64Array;
  /** Shoelace signed area of each closed path (0 for open paths). */
  readonly pathArea: Float64Array;
  /** Bounding box of each path. */
  readonly pathMinX: Float64Array;
  readonly pathMinY: Float64Array;
  readonly pathMaxX: Float64Array;
  readonly pathMaxY: Float64Array;
  /** The path's own segments (before splitting into pieces) are
   * seg*[segStart[path] .. segStart[path + 1]): a crossing count against a
   * long straight edge costs one test, not one per piece. */
  readonly segStart: Int32Array;
  readonly segAx: Float64Array;
  readonly segAy: Float64Array;
  readonly segBx: Float64Array;
  readonly segBy: Float64Array;
  readonly cellSize: number;
  readonly minX: number;
  readonly minY: number;
  readonly cols: number;
  readonly rows: number;
  /** Pieces of cell c are cellItems[cellStart[c] .. cellStart[c + 1]). */
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
  /** False when the piece budget ran out and later paths were left out. */
  readonly complete: boolean;
};

/** Element `i` of a typed array, 0 past its end (indices here are always in range). */
export function num(array: Float64Array | Int32Array, i: number): number {
  return array[i] ?? 0;
}

/** Grid size cap: a bed-sized job at a fine kerf would otherwise allocate tens
 * of millions of cells. Past it the cells grow, which only adds candidates. */
const MAX_GRID_CELLS = 1_000_000;
const PIECE_LENGTH_PER_RADIUS = 2;

type Segment = { readonly a: Vec2; readonly b: Vec2 };

function isFinitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

function pathSegments(path: MinFeaturePath): Segment[] {
  const out: Segment[] = [];
  let previous: Vec2 | undefined;
  for (const point of path.points.filter(isFinitePoint)) {
    if (previous !== undefined && !samePoint(previous, point)) out.push({ a: previous, b: point });
    previous = point;
  }
  const first = out[0]?.a;
  const last = out.at(-1)?.b;
  if (path.closed && first !== undefined && last !== undefined && !samePoint(first, last)) {
    out.push({ a: last, b: first });
  }
  return out;
}

function signedArea(segments: ReadonlyArray<Segment>): number {
  let twice = 0;
  for (const { a, b } of segments) twice += a.x * b.y - b.x * a.y;
  return twice / 2;
}

function piecesFor(segment: Segment, maxPieceLength: number): number {
  const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
  return Math.max(1, Math.ceil(length / maxPieceLength));
}

type PathPlan = {
  readonly segments: ReadonlyArray<Segment>;
  readonly pieces: number;
  readonly closed: boolean;
};

function planPaths(
  paths: ReadonlyArray<MinFeaturePath>,
  maxPieceLength: number,
  meter: MinFeatureWorkMeter,
): { readonly plans: PathPlan[]; readonly complete: boolean } {
  const plans: PathPlan[] = [];
  const stacked = new StackedOutlines();
  for (const path of paths) {
    const segments = pathSegments(path);
    if (segments.length === 0) continue;
    // A closed path needs at least a triangle to enclose anything.
    const closed = path.closed && segments.length >= 3;
    if (closed && stacked.isCopy(segments.map((segment) => segment.a))) continue;
    let pieces = 0;
    for (const segment of segments) pieces += piecesFor(segment, maxPieceLength);
    if (!meter.takePieces(pieces)) return { plans, complete: false };
    plans.push({ segments, pieces, closed });
  }
  return { plans, complete: true };
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function planBounds(plans: ReadonlyArray<PathPlan>): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const plan of plans) {
    for (const { a, b } of plan.segments) {
      bounds.minX = Math.min(bounds.minX, a.x, b.x);
      bounds.minY = Math.min(bounds.minY, a.y, b.y);
      bounds.maxX = Math.max(bounds.maxX, a.x, b.x);
      bounds.maxY = Math.max(bounds.maxY, a.y, b.y);
    }
  }
  return bounds;
}

/** Split paths into pieces no longer than 2 × `radius` and grid-index them. */
export function buildPieceIndex(
  paths: ReadonlyArray<MinFeaturePath>,
  radius: number,
  meter: MinFeatureWorkMeter,
): PieceIndex {
  const pieceLength = PIECE_LENGTH_PER_RADIUS * radius;
  const { plans, complete } = planPaths(paths, pieceLength, meter);
  const total = plans.reduce((sum, plan) => sum + plan.pieces, 0);
  const index = allocate(plans, total, radius, complete);
  let next = 0;
  let nextSegment = 0;
  plans.forEach((plan, pathIndex) => {
    index.pathStart[pathIndex] = next;
    index.segStart[pathIndex] = nextSegment;
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    let arc = 0;
    for (const segment of plan.segments) {
      index.segAx[nextSegment] = segment.a.x;
      index.segAy[nextSegment] = segment.a.y;
      index.segBx[nextSegment] = segment.b.x;
      index.segBy[nextSegment] = segment.b.y;
      nextSegment += 1;
      box.minX = Math.min(box.minX, segment.a.x, segment.b.x);
      box.minY = Math.min(box.minY, segment.a.y, segment.b.y);
      box.maxX = Math.max(box.maxX, segment.a.x, segment.b.x);
      box.maxY = Math.max(box.maxY, segment.a.y, segment.b.y);
      const count = piecesFor(segment, pieceLength);
      const dx = (segment.b.x - segment.a.x) / count;
      const dy = (segment.b.y - segment.a.y) / count;
      const step = Math.hypot(dx, dy);
      for (let k = 0; k < count; k += 1) {
        index.ax[next] = segment.a.x + dx * k;
        index.ay[next] = segment.a.y + dy * k;
        index.bx[next] = k === count - 1 ? segment.b.x : segment.a.x + dx * (k + 1);
        index.by[next] = k === count - 1 ? segment.b.y : segment.a.y + dy * (k + 1);
        index.s0[next] = arc;
        index.path[next] = pathIndex;
        arc += step;
        next += 1;
      }
    }
    index.pathLength[pathIndex] = arc;
    index.pathArea[pathIndex] = plan.closed ? signedArea(plan.segments) : 0;
    index.pathMinX[pathIndex] = box.minX;
    index.pathMinY[pathIndex] = box.minY;
    index.pathMaxX[pathIndex] = box.maxX;
    index.pathMaxY[pathIndex] = box.maxY;
  });
  index.segStart[plans.length] = nextSegment;
  return withCells(index);
}

function allocate(
  plans: ReadonlyArray<PathPlan>,
  total: number,
  radius: number,
  complete: boolean,
): PieceIndex {
  const bounds = planBounds(plans);
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  const spanX = Number.isFinite(bounds.maxX) ? bounds.maxX - minX : 0;
  const spanY = Number.isFinite(bounds.maxY) ? bounds.maxY - minY : 0;
  const cellSize = Math.max(
    radius,
    Math.sqrt(((spanX + radius) * (spanY + radius)) / MAX_GRID_CELLS),
  );
  const cols = Math.floor(spanX / cellSize) + 1;
  const rows = Math.floor(spanY / cellSize) + 1;
  const segments = plans.reduce((sum, plan) => sum + plan.segments.length, 0);
  return {
    count: total,
    ax: new Float64Array(total),
    ay: new Float64Array(total),
    bx: new Float64Array(total),
    by: new Float64Array(total),
    s0: new Float64Array(total),
    path: new Int32Array(total),
    pathStart: new Int32Array(plans.length),
    pathClosed: plans.map((plan) => plan.closed),
    pathLength: new Float64Array(plans.length),
    pathArea: new Float64Array(plans.length),
    pathMinX: new Float64Array(plans.length),
    pathMinY: new Float64Array(plans.length),
    pathMaxX: new Float64Array(plans.length),
    pathMaxY: new Float64Array(plans.length),
    segStart: new Int32Array(plans.length + 1),
    segAx: new Float64Array(segments),
    segAy: new Float64Array(segments),
    segBx: new Float64Array(segments),
    segBy: new Float64Array(segments),
    cellSize,
    minX,
    minY,
    cols,
    rows,
    cellStart: new Int32Array(cols * rows + 1),
    cellItems: new Int32Array(0),
    complete,
  };
}

/** The piece after `piece` along its path (wrapping on a closed path), or -1. */
export function nextPieceOnPath(index: PieceIndex, piece: number): number {
  const path = num(index.path, piece);
  if (piece + 1 < index.count && index.path[piece + 1] === path) return piece + 1;
  if (index.pathClosed[path] !== true) return -1;
  const first = index.pathStart[path] ?? piece;
  return first === piece ? -1 : first;
}

export function cellColumn(index: PieceIndex, x: number): number {
  return Math.min(index.cols - 1, Math.max(0, Math.floor((x - index.minX) / index.cellSize)));
}

export function cellRow(index: PieceIndex, y: number): number {
  return Math.min(index.rows - 1, Math.max(0, Math.floor((y - index.minY) / index.cellSize)));
}

export function cellKey(index: PieceIndex, column: number, row: number): number {
  return row * index.cols + column;
}

type CellRange = { c0: number; c1: number; r0: number; r1: number };

function pieceCells(index: PieceIndex, piece: number, range: CellRange): void {
  const ax = num(index.ax, piece);
  const ay = num(index.ay, piece);
  const bx = num(index.bx, piece);
  const by = num(index.by, piece);
  range.c0 = cellColumn(index, Math.min(ax, bx));
  range.c1 = cellColumn(index, Math.max(ax, bx));
  range.r0 = cellRow(index, Math.min(ay, by));
  range.r1 = cellRow(index, Math.max(ay, by));
}

function withCells(index: PieceIndex): PieceIndex {
  const counts = index.cellStart;
  const range: CellRange = { c0: 0, c1: 0, r0: 0, r1: 0 };
  let entries = 0;
  for (let piece = 0; piece < index.count; piece += 1) {
    pieceCells(index, piece, range);
    for (let row = range.r0; row <= range.r1; row += 1) {
      for (let column = range.c0; column <= range.c1; column += 1) {
        const key = cellKey(index, column, row) + 1;
        counts[key] = num(counts, key) + 1;
        entries += 1;
      }
    }
  }
  for (let key = 1; key < counts.length; key += 1)
    counts[key] = num(counts, key) + num(counts, key - 1);
  const items = new Int32Array(entries);
  const cursor = counts.slice(0, counts.length - 1);
  for (let piece = 0; piece < index.count; piece += 1) {
    pieceCells(index, piece, range);
    for (let row = range.r0; row <= range.r1; row += 1) {
      for (let column = range.c0; column <= range.c1; column += 1) {
        const key = cellKey(index, column, row);
        const slot = num(cursor, key);
        items[slot] = piece;
        cursor[key] = slot + 1;
      }
    }
  }
  return { ...index, cellItems: items };
}
