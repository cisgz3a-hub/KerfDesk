// The outline a tabbed or perforated contour still cuts, rebuilt from its
// pieces for laser-lead containment (ADR-626).
//
// Greedy: from the first piece, always continue with the unused piece whose
// nearer end is closest to where the outline has got to, reversed when its far
// end is the nearer one. The pieces of one contour meet across tab or dash
// gaps, so this recovers their order whatever order the planner left them in.
//
// A gap is uncut, so its path is not in the job. Across a straight edge the
// straight bridge is exact; across a corner it would cut the corner off, and a
// small hole in the cut-off triangle would read as outside the outline. So
// where the pieces on either side of a gap run toward a common corner, the
// corner is put back: the point where the edge leaving the gap's start meets
// the edge reaching its end.

import type { Vec2 } from '../scene';

// Closer than this, two piece ends touch and there is no gap to bridge.
const GAP_MM = 1e-6;
// A corner put back lies at most this many gap lengths from either side.
const MAX_CORNER_REACH = 2;

// Up to this many pieces each step scans them all; above it an endpoint grid
// finds the same nearest piece, so a contour cut as thousands of dashes is
// chained in about linear time instead of being left out.
const LINEAR_PIECES = 64;

type NextPiece = { readonly index: number; readonly reversed: boolean };

export function chainPieces(pieces: ReadonlyArray<ReadonlyArray<Vec2>>): ReadonlyArray<Vec2> {
  const used = new Array<boolean>(pieces.length).fill(false);
  const outline: Vec2[] = [...(pieces[0] ?? [])];
  used[0] = true;
  const grid = pieces.length > LINEAR_PIECES ? EndpointGrid.create(pieces) : null;
  for (let step = 1; step < pieces.length; step += 1) {
    const tail = outline[outline.length - 1];
    if (tail === undefined) break;
    const next =
      grid === null ? nearestPiece(pieces, used, tail) : grid.nearest(pieces, used, tail);
    if (next === null) break;
    used[next.index] = true;
    const piece = pieces[next.index] ?? [];
    const oriented = next.reversed ? [...piece].reverse() : piece;
    pushCorner(outline, outline, oriented);
    outline.push(...oriented);
  }
  // The gap back to the first piece closes the ring.
  pushCorner(outline, outline, outline);
  return outline;
}

// The unused piece with the nearest end; ties go to the lower index, and to
// its start over its end.
function nearestPiece(
  pieces: ReadonlyArray<ReadonlyArray<Vec2>>,
  used: ReadonlyArray<boolean>,
  tail: Vec2,
): NextPiece | null {
  const best = new BestPiece(pieces, tail);
  for (let index = 0; index < pieces.length; index += 1) {
    if (used[index] !== true) best.offer(index);
  }
  return best.piece;
}

class BestPiece {
  piece: NextPiece | null = null;
  distanceSq = Number.POSITIVE_INFINITY;

  constructor(
    private readonly pieces: ReadonlyArray<ReadonlyArray<Vec2>>,
    private readonly tail: Vec2,
  ) {}

  offer(index: number): void {
    const piece = this.pieces[index] ?? [];
    const startSq = distanceSq(this.tail, piece[0]);
    const endSq = distanceSq(this.tail, piece[piece.length - 1]);
    const nearSq = Math.min(startSq, endSq);
    const current = this.piece;
    if (
      nearSq < this.distanceSq ||
      (nearSq === this.distanceSq && current !== null && index < current.index)
    ) {
      this.piece = { index, reversed: endSq < startSq };
      this.distanceSq = nearSq;
    }
  }
}

// Piece ends in square cells about one piece long. A query searches rings of
// cells outward from the tail until nothing unsearched can be nearer than the
// best end found, so it returns exactly what the full scan would.
class EndpointGrid {
  private constructor(
    private readonly cells: ReadonlyMap<string, ReadonlyArray<number>>,
    private readonly cellMm: number,
    private readonly span: number,
  ) {}

  static create(pieces: ReadonlyArray<ReadonlyArray<Vec2>>): EndpointGrid {
    let length = 0;
    for (const piece of pieces) length += polylineLength(piece);
    const cellMm = Math.max(1e-3, length / pieces.length);
    const cells = new Map<string, number[]>();
    let minCell = Number.POSITIVE_INFINITY;
    let maxCell = Number.NEGATIVE_INFINITY;
    pieces.forEach((piece, index) => {
      for (const end of [piece[0], piece[piece.length - 1]]) {
        if (end === undefined || !Number.isFinite(end.x) || !Number.isFinite(end.y)) continue;
        const cx = Math.floor(end.x / cellMm);
        const cy = Math.floor(end.y / cellMm);
        minCell = Math.min(minCell, cx, cy);
        maxCell = Math.max(maxCell, cx, cy);
        const key = `${cx},${cy}`;
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [index]);
        else if (list[list.length - 1] !== index) list.push(index);
      }
    });
    return new EndpointGrid(cells, cellMm, Math.max(0, maxCell - minCell) + 1);
  }

  nearest(
    pieces: ReadonlyArray<ReadonlyArray<Vec2>>,
    used: ReadonlyArray<boolean>,
    tail: Vec2,
  ): NextPiece | null {
    const best = new BestPiece(pieces, tail);
    const cx = Math.floor(tail.x / this.cellMm);
    const cy = Math.floor(tail.y / this.cellMm);
    for (let ring = 0; ring <= this.span; ring += 1) {
      this.searchRing(cx, cy, ring, used, best);
      const reach = ring * this.cellMm;
      if (best.piece !== null && best.distanceSq < reach * reach) break;
    }
    return best.piece;
  }

  private searchRing(
    cx: number,
    cy: number,
    ring: number,
    used: ReadonlyArray<boolean>,
    best: BestPiece,
  ): void {
    for (let dx = -ring; dx <= ring; dx += 1) {
      const edge = Math.abs(dx) === ring;
      for (let dy = -ring; dy <= ring; dy += edge ? 1 : 2 * ring) {
        for (const index of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (used[index] !== true) best.offer(index);
        }
        if (ring === 0) break;
      }
    }
  }
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/** Appends the corner a gap from the end of `before` to the start of `after`
 * passes round, when there is one. */
function pushCorner(
  outline: Vec2[],
  before: ReadonlyArray<Vec2>,
  after: ReadonlyArray<Vec2>,
): void {
  const corner = gapCorner(before, after);
  if (corner !== null) outline.push(corner);
}

function gapCorner(before: ReadonlyArray<Vec2>, after: ReadonlyArray<Vec2>): Vec2 | null {
  const tail = before[before.length - 1];
  const head = after[0];
  if (tail === undefined || head === undefined) return null;
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const gap = Math.hypot(dx, dy);
  if (gap <= GAP_MM) return null;
  const leaving = arrivingDirection(before);
  const reaching = leavingDirection(after);
  if (leaving === null || reaching === null) return null;
  const cross = leaving.x * reaching.y - leaving.y * reaching.x;
  // Parallel edges: the gap is straight, and so is its bridge.
  if (Math.abs(cross) < 1e-9) return null;
  const ahead = (dx * reaching.y - dy * reaching.x) / cross;
  const behind = (dx * leaving.y - dy * leaving.x) / cross;
  if (!(ahead > 0 && behind < 0)) return null;
  if (ahead > MAX_CORNER_REACH * gap || -behind > MAX_CORNER_REACH * gap) return null;
  return { x: tail.x + ahead * leaving.x, y: tail.y + ahead * leaving.y };
}

function arrivingDirection(points: ReadonlyArray<Vec2>): Vec2 | null {
  const end = points[points.length - 1];
  if (end === undefined) return null;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const direction = unit(points[index] as Vec2, end);
    if (direction !== null) return direction;
  }
  return null;
}

function leavingDirection(points: ReadonlyArray<Vec2>): Vec2 | null {
  const start = points[0];
  if (start === undefined) return null;
  for (let index = 1; index < points.length; index += 1) {
    const direction = unit(start, points[index] as Vec2);
    if (direction !== null) return direction;
  }
  return null;
}

function unit(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > GAP_MM ? { x: dx / length, y: dy / length } : null;
}

function distanceSq(a: Vec2, b: Vec2 | undefined): number {
  if (b === undefined) return Number.POSITIVE_INFINITY;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
