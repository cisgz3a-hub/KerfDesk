// What a laser lead must keep clear of (ADR-626): every cut line in the job,
// indexed in a uniform grid so a lead can ask how close it comes to them, and
// every closed ring, indexed by its bounds so a lead can ask which rings hold
// a point. Lines are the burns themselves, open or closed, from every Line cut
// group; rings are the closed contours, including the outline a tabbed or
// perforated contour still draws in pieces (laser-lead-rings.ts).

import type { Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';
import type { SegmentBounds } from './segment-bounds';

export type LeadRing = {
  /** The ring's outline; its last point may repeat its first. */
  readonly points: ReadonlyArray<Vec2>;
  readonly bounds: SegmentBounds;
  readonly lengthMm: number;
  /** The lines that burn this ring. */
  readonly lineIds: ReadonlyArray<number>;
  readonly nesting?: { readonly forest: string; readonly depth: number };
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
  readonly cells: ReadonlyMap<number, ReadonlyArray<number>>;
  readonly wide: ReadonlyArray<number>;
};

type Chords = {
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly line: Int32Array;
};

export class LeadObstacles {
  private constructor(
    private readonly chords: Chords,
    private readonly grid: Grid,
    private readonly ringIndex: ContourBoxIndex<SegmentBounds & { readonly ring: number }> | null,
    readonly rings: ReadonlyArray<LeadRing>,
  ) {}

  static create(
    lines: ReadonlyArray<ReadonlyArray<Vec2>>,
    rings: ReadonlyArray<LeadRing>,
  ): LeadObstacles {
    const chords = collectChords(lines);
    const boxes = rings.flatMap((ring, index) =>
      finiteBounds(ring.bounds) ? [{ ...ring.bounds, ring: index }] : [],
    );
    return new LeadObstacles(
      chords,
      chordGrid(chords),
      boxes.length === 0 ? null : ContourBoxIndex.create(boxes),
      rings,
    );
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
  let count = 0;
  for (const points of lines) count += Math.max(0, points.length - 1);
  const chords: Chords = {
    ax: new Float64Array(count),
    ay: new Float64Array(count),
    bx: new Float64Array(count),
    by: new Float64Array(count),
    line: new Int32Array(count),
  };
  let next = 0;
  lines.forEach((points, lineId) => {
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1] as Vec2;
      const b = points[index] as Vec2;
      chords.ax[next] = a.x;
      chords.ay[next] = a.y;
      chords.bx[next] = b.x;
      chords.by[next] = b.y;
      chords.line[next] = lineId;
      next += 1;
    }
  });
  return chords;
}

function chordGrid(chords: Chords): Grid {
  const cells = new Map<number, number[]>();
  const wide: number[] = [];
  const add = (cx: number, cy: number, chord: number): void => {
    const key = cellKey(cx, cy);
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [chord]);
    else if (list[list.length - 1] !== chord) list.push(chord);
  };
  for (let chord = 0; chord < chords.line.length; chord += 1) {
    const ax = chords.ax[chord] as number;
    const ay = chords.ay[chord] as number;
    const bx = chords.bx[chord] as number;
    const by = chords.by[chord] as number;
    if (![ax, ay, bx, by].every(Number.isFinite)) continue;
    const pieces = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / PIECE_MM));
    if (pieces > MAX_GRID_PIECES) {
      wide.push(chord);
      continue;
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
          add(cx, cy, chord);
        }
      }
    }
  }
  return { cells, wide };
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

function finiteBounds(bounds: SegmentBounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY)
  );
}
