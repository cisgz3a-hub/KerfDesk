import type { Vec2 } from '../scene';
import {
  largestCircularArc,
  POINT_MM,
  rimArcsInDisk,
  rimArcsInStrip,
  subtract,
  TAU,
  type Arcs,
  type RimMove,
} from './adaptive-pocket-rim-arcs';

// Exact cutter contact for the adaptive verifier (ADR-154 Amendment 3).
//
// Stock at a point of the cutter's rim is still uncut when no earlier move of
// the cutter passed closer than the cutter radius to it. An earlier straight
// move clears a capsule and the entry helix a disk, so the part of the rim each
// one has cleared is a few arcs in closed form, and what is left of the rim is
// the contact. Containment is certified first and keeps the cutter inside the
// pocket, so no boundary test is needed here. The verifier used to read the
// contact from its stock grid, whose cell at the default engagement is as wide
// as the ring spacing: each ring's cut was one cell thick, and the grid read
// the engagement up to 0.3 mm too high and 0.17 mm too low.

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

// A straight move and what the clearing needs of it, worked out once.
type Move = Bounds & RimMove & { readonly b: Vec2 };

type Entry = { readonly centre: Vec2; readonly pathRadiusMm: number };

// An open arc's end directions, when it is shorter than a half turn.
type Facing = {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
};

type Clearing = {
  open: Arcs;
  openBounds: Bounds;
  // Null when an open arc is a half turn or longer and faces every way.
  openFacing: ReadonlyArray<Facing> | null;
};

// Bucket columns and rows fold into one number key; the offset keeps them
// positive for any bed coordinate this library can hold.
const BUCKET_OFFSET = 2 ** 20;
const BUCKET_STRIDE = 2 ** 21;
// Path neighbours either side of the last move that narrowed the contact.
const HINT_SPAN = 4;

export class AdaptiveCutterContact {
  private readonly moves: Move[] = [];
  private readonly entries: Entry[] = [];
  private readonly buckets = new Map<number, number[]>();
  private readonly visited: number[] = [];
  private visit = 0;
  private hint = 0;
  private readonly bucketMm: number;

  constructor(readonly toolRadiusMm: number) {
    this.bucketMm = toolRadiusMm / 2;
  }

  // The entry helix sweeps its path circle with the cutter.
  addEntry(centre: Vec2, pathRadiusMm: number): void {
    this.entries.push({ centre, pathRadiusMm });
  }

  addMove(a: Vec2, b: Vec2): void {
    const index = this.moves.length;
    const move = straightMove(a, b);
    this.moves.push(move);
    this.visited.push(0);
    this.forEachBucketKey(move, (key) => {
      const bucket = this.buckets.get(key);
      if (bucket === undefined) this.buckets.set(key, [index]);
      else bucket.push(index);
    });
  }

  // Simulated radial engagement (ADR-154 amendment of 2026-08-02) with the
  // cutter at `point`, reached by a straight move from `moveStart`: the
  // largest arc of the rim still in stock, as r * (1 - cos(arc / 2)).
  engagementMm(point: Vec2, moveStart: Vec2): number {
    const r = this.toolRadiusMm;
    let open: Arcs = clearCapsule([0, TAU], point, r, straightMove(moveStart, point));
    for (const entry of this.entries) {
      open = subtract(open, entryArcs(point, r, entry));
    }
    if (open.length === 0) return 0;
    open = this.clearEarlierMoves(open, point);
    const arc = largestCircularArc(open);
    return r * (1 - Math.cos(Math.min(Math.PI, arc) / 2));
  }

  // Only a move within r of a rim point still open, and facing it, can clear
  // it. The box and the facing of the open arcs are kept current, so once the
  // contact arc alone is open, the older rings further in and the moves behind
  // the cutter are passed over unmeasured. The order only decides how soon
  // that happens: first the path neighbours of the move that narrowed the
  // contact last time (on a ring, the previous ring beside the cutter), then
  // the moves close by, then the buckets within r of what is still open.
  private clearEarlierMoves(start: Arcs, point: Vec2): Arcs {
    const r = this.toolRadiusMm;
    const clearing: Clearing = {
      open: start,
      openBounds: arcsBounds(start, point, r),
      openFacing: arcsFacing(start),
    };
    this.visit += 1;
    const last = Math.min(this.moves.length - 1, this.hint + HINT_SPAN);
    for (let index = Math.max(0, this.hint - HINT_SPAN); index <= last; index += 1) {
      this.clearWith(clearing, point, index);
    }
    const near = r / 2;
    this.clearIn(clearing, point, {
      minX: point.x - near,
      minY: point.y - near,
      maxX: point.x + near,
      maxY: point.y + near,
    });
    if (clearing.open.length > 0) this.clearIn(clearing, point, grow(clearing.openBounds, r));
    return clearing.open;
  }

  private clearIn(clearing: Clearing, point: Vec2, region: Bounds): void {
    this.forEachBucketKey(region, (key) => {
      for (const index of this.buckets.get(key) ?? []) {
        if (clearing.open.length === 0) return;
        this.clearWith(clearing, point, index);
      }
    });
  }

  private clearWith(clearing: Clearing, point: Vec2, index: number): void {
    const r = this.toolRadiusMm;
    if (clearing.open.length === 0 || this.visited[index] === this.visit) return;
    this.visited[index] = this.visit;
    const move = this.moves[index];
    if (move === undefined || boxGapSquared(move, clearing.openBounds) >= r * r) return;
    if (!facesOpenArcs(clearing.openFacing, point, move)) return;
    if (segmentDistanceSquared(point, move.a, move.b) >= 4 * r * r) return;
    const next = clearCapsule(clearing.open, point, r, move);
    if (next === clearing.open) return;
    clearing.open = next;
    this.hint = index;
    if (next.length > 0) {
      clearing.openBounds = arcsBounds(next, point, r);
      clearing.openFacing = arcsFacing(next);
    }
  }

  private forEachBucketKey(bounds: Bounds, visit: (key: number) => void): void {
    const size = this.bucketMm;
    const lastCol = Math.floor(bounds.maxX / size);
    const lastRow = Math.floor(bounds.maxY / size);
    for (let col = Math.floor(bounds.minX / size); col <= lastCol; col += 1) {
      for (let row = Math.floor(bounds.minY / size); row <= lastRow; row += 1) {
        visit((col + BUCKET_OFFSET) * BUCKET_STRIDE + row + BUCKET_OFFSET);
      }
    }
  }
}

function straightMove(a: Vec2, b: Vec2): Move {
  const length = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  const ux = length <= POINT_MM ? 1 : (b.x - a.x) / length;
  const uy = length <= POINT_MM ? 0 : (b.y - a.y) / length;
  return {
    a,
    b,
    length,
    ux,
    uy,
    heading: Math.atan2(uy, ux),
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

// The rim arcs a move clears: its two end disks and the strip between them,
// each strictly within the cutter radius of the move.
function clearCapsule(open: Arcs, point: Vec2, r: number, move: Move): Arcs {
  let next = subtract(open, rimArcsInDisk(point, r, move.a, r));
  next = subtract(next, rimArcsInDisk(point, r, move.b, r));
  return subtract(next, rimArcsInStrip(point, r, move));
}

function entryArcs(point: Vec2, r: number, entry: Entry): Arcs {
  const outer = rimArcsInDisk(point, r, entry.centre, entry.pathRadiusMm + r);
  // A helix wider than the cutter leaves a core of stock inside its path.
  return entry.pathRadiusMm <= r
    ? outer
    : subtract(outer, rimArcsInDisk(point, r, entry.centre, entry.pathRadiusMm - r));
}

function grow(bounds: Bounds, margin: number): Bounds {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  };
}

// The squared distance between two boxes, zero when they overlap.
function boxGapSquared(first: Bounds, second: Bounds): number {
  const dx = Math.max(0, first.minX - second.maxX, second.minX - first.maxX);
  const dy = Math.max(0, first.minY - second.maxY, second.minY - first.maxY);
  return dx * dx + dy * dy;
}

// The box holding every rim point of the open arcs.
function arcsBounds(open: Arcs, point: Vec2, r: number): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (angle: number): void => {
    const x = point.x + r * Math.cos(angle);
    const y = point.y + r * Math.sin(angle);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (let index = 0; index + 1 < open.length; index += 2) {
    const start = open[index] ?? 0;
    const end = open[index + 1] ?? 0;
    include(start);
    include(end);
    for (let quarter = 1; quarter <= 3; quarter += 1) {
      const axis = (quarter * Math.PI) / 2;
      if (axis > start && axis < end) include(axis);
    }
  }
  return { minX, minY, maxX, maxY };
}

function arcsFacing(open: Arcs): ReadonlyArray<Facing> | null {
  const facing: Facing[] = [];
  for (let index = 0; index + 1 < open.length; index += 2) {
    const start = open[index] ?? 0;
    const end = open[index + 1] ?? 0;
    if (end - start >= Math.PI) return null;
    facing.push({
      startX: Math.cos(start),
      startY: Math.sin(start),
      endX: Math.cos(end),
      endY: Math.sin(end),
    });
  }
  return facing;
}

// A move clears the rim point p + r u only through a point s of it with
// (s - p) . u > |s - p|^2 / 2r, so above zero. That projection is linear
// along the move, so a move whose two ends face away from every direction of
// every open arc cannot clear any of them.
function facesOpenArcs(facing: ReadonlyArray<Facing> | null, point: Vec2, move: Move): boolean {
  if (facing === null) return true;
  for (const arc of facing) {
    for (const end of [move.a, move.b]) {
      const dx = end.x - point.x;
      const dy = end.y - point.y;
      if (dx * arc.startX + dy * arc.startY > 0 || dx * arc.endX + dy * arc.endY > 0) return true;
      const within = arc.startX * dy - arc.startY * dx >= 0 && dx * arc.endY - dy * arc.endX >= 0;
      if (within && (dx !== 0 || dy !== 0)) return true;
    }
  }
  return false;
}

function segmentDistanceSquared(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const x = point.x - (a.x + t * dx);
  const y = point.y - (a.y + t * dy);
  return x * x + y * y;
}
