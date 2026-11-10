// What a laser lead must keep clear of (ADR-626): every cut line in the job,
// indexed in a uniform grid so a lead can ask how close it comes to them, and
// every closed ring, indexed by its bounds so a lead can ask which rings hold
// a point. Lines are the burns themselves, open or closed, from every Line cut
// group; rings are the closed contours, including the outline a tabbed or
// perforated contour still draws in pieces (laser-lead-rings.ts). Leads join
// the lines once placed (addLine), so a later lead keeps clear of them too.

import type { Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';
import type { SegmentBounds } from './segment-bounds';
import { isFiniteBox } from '../geometry/box-math';

export type LeadRing = {
  /** The ring's outline; its last point may repeat its first. */
  readonly points: ReadonlyArray<Vec2>;
  readonly bounds: SegmentBounds;
  readonly lengthMm: number;
  /** The lines that burn this ring. */
  readonly lineIds: ReadonlyArray<number>;
  /** The scene contour it was cut from (CutSegment.leadSource), when known. */
  readonly source?: string;
};

const CELL_MM = 1;
const KEY_OFFSET = 2 ** 21;
const KEY_SPAN = 2 ** 22;
// A chord is registered piece by piece, each piece at most half a cell long,
// so it sits in every cell it passes through and in few others.
const PIECE_MM = CELL_MM / 2;
// A chord longer than this many pieces (1 m) is checked by every query
// instead, so one very long line cannot fill the grid.
const MAX_GRID_PIECES = 2000;

type Grid = {
  readonly cells: Map<number, number[]>;
  readonly wide: number[];
};

type Chords = {
  readonly ax: number[];
  readonly ay: number[];
  readonly bx: number[];
  readonly by: number[];
  readonly line: number[];
};

export class LeadObstacles {
  private constructor(
    private readonly chords: Chords,
    private readonly grid: Grid,
    private readonly ringIndex: ContourBoxIndex<SegmentBounds & { readonly ring: number }> | null,
    readonly rings: ReadonlyArray<LeadRing>,
    private nextLine: number,
  ) {}

  static create(
    lines: ReadonlyArray<ReadonlyArray<Vec2>>,
    rings: ReadonlyArray<LeadRing>,
  ): LeadObstacles {
    const chords = collectChords(lines);
    const boxes = rings.flatMap((ring, index) =>
      isFiniteBox(ring.bounds) ? [{ ...ring.bounds, ring: index }] : [],
    );
    const grid: Grid = { cells: new Map(), wide: [] };
    for (let chord = 0; chord < chords.line.length; chord += 1) insertChord(grid, chords, chord);
    return new LeadObstacles(
      chords,
      grid,
      boxes.length === 0 ? null : ContourBoxIndex.create(boxes),
      rings,
      lines.length,
    );
  }

  /** Adds a line (a placed lead) for later queries; returns its line id. */
  addLine(points: ReadonlyArray<Vec2>): number {
    const lineId = this.nextLine;
    this.nextLine += 1;
    for (let index = 1; index < points.length; index += 1) {
      const chord = pushChord(
        this.chords,
        points[index - 1] as Vec2,
        points[index] as Vec2,
        lineId,
      );
      insertChord(this.grid, this.chords, chord);
    }
    return lineId;
  }

  /** How far `point` is from line `own`, and from the nearest other line that
   * `ignored` does not hold, each capped at `capMm`: one scan of the grid. */
  distancesMm(
    point: Vec2,
    capMm: number,
    own: number,
    ignored: ReadonlySet<number>,
  ): { readonly ownMm: number; readonly otherMm: number } {
    const nearest = { ownSq: capMm * capMm, otherSq: capMm * capMm };
    const visit = (chord: number): void => this.visitChord(chord, point, own, ignored, nearest);
    const loX = cellOf(point.x - capMm);
    const hiX = cellOf(point.x + capMm);
    const loY = cellOf(point.y - capMm);
    const hiY = cellOf(point.y + capMm);
    for (let cx = loX; cx <= hiX; cx += 1) {
      for (let cy = loY; cy <= hiY; cy += 1) {
        for (const chord of this.grid.cells.get(cellKey(cx, cy)) ?? []) visit(chord);
      }
    }
    for (const chord of this.grid.wide) visit(chord);
    return { ownMm: Math.sqrt(nearest.ownSq), otherMm: Math.sqrt(nearest.otherSq) };
  }

  /** Tests the complete walking chord, including its interior. Point samples
   * alone can miss a short neighbouring cut's closest approach between them. */
  otherLinesClear(
    a: Vec2,
    b: Vec2,
    clearanceMm: number,
    own: number,
    ignored: ReadonlySet<number>,
  ): boolean {
    const { ax, ay, bx, by, line } = this.chords;
    const tooClose = (chord: number): boolean => {
      const owner = line[chord] as number;
      if (owner === own || ignored.has(owner)) return false;
      return (
        chordDistanceSq(
          a,
          b,
          ax[chord] as number,
          ay[chord] as number,
          bx[chord] as number,
          by[chord] as number,
        ) <
        clearanceMm * clearanceMm
      );
    };
    const loX = cellOf(Math.min(a.x, b.x) - clearanceMm);
    const hiX = cellOf(Math.max(a.x, b.x) + clearanceMm);
    const loY = cellOf(Math.min(a.y, b.y) - clearanceMm);
    const hiY = cellOf(Math.max(a.y, b.y) + clearanceMm);
    for (let cx = loX; cx <= hiX; cx += 1) {
      for (let cy = loY; cy <= hiY; cy += 1) {
        if ((this.grid.cells.get(cellKey(cx, cy)) ?? []).some(tooClose)) return false;
      }
    }
    return !this.grid.wide.some(tooClose);
  }

  private visitChord(
    chord: number,
    point: Vec2,
    own: number,
    ignored: ReadonlySet<number>,
    nearest: { ownSq: number; otherSq: number },
  ): void {
    const { ax, ay, bx, by, line } = this.chords;
    const owner = line[chord] as number;
    const isOwn = owner === own;
    if (!isOwn && ignored.has(owner)) return;
    const distSq = segmentDistanceSq(
      point,
      ax[chord] as number,
      ay[chord] as number,
      bx[chord] as number,
      by[chord] as number,
    );
    if (isOwn) nearest.ownSq = Math.min(nearest.ownSq, distSq);
    else nearest.otherSq = Math.min(nearest.otherSq, distSq);
  }

  /** The rings whose bounds hold `point`. */
  ringsHolding(point: Vec2): ReadonlyArray<number> {
    if (this.ringIndex === null) return [];
    return this.ringIndex
      .query({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y })
      .map((box) => box.ring);
  }
}

function collectChords(lines: ReadonlyArray<ReadonlyArray<Vec2>>): Chords {
  const chords: Chords = { ax: [], ay: [], bx: [], by: [], line: [] };
  lines.forEach((points, lineId) => {
    for (let index = 1; index < points.length; index += 1) {
      pushChord(chords, points[index - 1] as Vec2, points[index] as Vec2, lineId);
    }
  });
  return chords;
}

function pushChord(chords: Chords, a: Vec2, b: Vec2, lineId: number): number {
  chords.ax.push(a.x);
  chords.ay.push(a.y);
  chords.bx.push(b.x);
  chords.by.push(b.y);
  chords.line.push(lineId);
  return chords.line.length - 1;
}

function insertChord(grid: Grid, chords: Chords, chord: number): void {
  const ax = chords.ax[chord] as number;
  const ay = chords.ay[chord] as number;
  const bx = chords.bx[chord] as number;
  const by = chords.by[chord] as number;
  if (![ax, ay, bx, by].every(Number.isFinite)) return;
  const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / PIECE_MM));
  if (pieces > MAX_GRID_PIECES) {
    grid.wide.push(chord);
    return;
  }
  for (let piece = 0; piece < pieces; piece += 1) {
    const t0 = piece / pieces;
    const t1 = (piece + 1) / pieces;
    const x0 = ax + (bx - ax) * t0;
    const y0 = ay + (by - ay) * t0;
    const x1 = ax + (bx - ax) * t1;
    const y1 = ay + (by - ay) * t1;
    for (let cx = cellOf(Math.min(x0, x1)); cx <= cellOf(Math.max(x0, x1)); cx += 1) {
      for (let cy = cellOf(Math.min(y0, y1)); cy <= cellOf(Math.max(y0, y1)); cy += 1) {
        addToCell(grid.cells, cellKey(cx, cy), chord);
      }
    }
  }
}

function addToCell(cells: Map<number, number[]>, key: number, chord: number): void {
  const list = cells.get(key);
  if (list === undefined) cells.set(key, [chord]);
  else if (list[list.length - 1] !== chord) list.push(chord);
}

function cellOf(value: number): number {
  return Math.floor(value / CELL_MM);
}

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_OFFSET) * KEY_SPAN + (cy + KEY_OFFSET);
}

function segmentDistanceSq(point: Vec2, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / lengthSq));
  const ox = point.x - (ax + t * dx);
  const oy = point.y - (ay + t * dy);
  return ox * ox + oy * oy;
}

// In 2D, intersecting segments have distance zero; otherwise their closest
// pair includes at least one endpoint. Parallel and zero-length segments are
// therefore handled by the endpoint distances too.
function chordDistanceSq(a: Vec2, b: Vec2, cx: number, cy: number, dx: number, dy: number): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = dx - cx;
  const vy = dy - cy;
  const determinant = ux * vy - uy * vx;
  if (determinant !== 0) {
    const wx = cx - a.x;
    const wy = cy - a.y;
    const t = (wx * vy - wy * vx) / determinant;
    const u = (wx * uy - wy * ux) / determinant;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    segmentDistanceSq(a, cx, cy, dx, dy),
    segmentDistanceSq(b, cx, cy, dx, dy),
    segmentDistanceSq({ x: cx, y: cy }, a.x, a.y, b.x, b.y),
    segmentDistanceSq({ x: dx, y: dy }, a.x, a.y, b.x, b.y),
  );
}
