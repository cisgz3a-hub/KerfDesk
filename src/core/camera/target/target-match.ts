// Index detected rings onto the bed target grid (ADR-441). The anchor L gives
// the origin and one grid step along each axis; the grid then grows outward
// ring by ring, predicting each neighbour from the local step (so fisheye
// curvature is followed rather than fought) and accepting only a ring close
// to the prediction with a similar size. Pure core.

import type { BedTargetLayout, BedTargetMark } from './bed-target';
import type { RingMark } from './ring-detect';
import { maxOf, minOf } from '../../util';
import { distance, subtractPoints, scalePoint, cross } from '../../geometry/point-math';

type Vec2 = { readonly x: number; readonly y: number };

export type TargetCorrespondence = { readonly mark: BedTargetMark; readonly pixel: Vec2 };

export type TargetMatch =
  | {
      readonly kind: 'ok';
      readonly correspondences: ReadonlyArray<TargetCorrespondence>;
      readonly expected: number;
    }
  | { readonly kind: 'failed'; readonly reason: TargetMatchFailure };

/**
 * 'anchors-unclear': discs other than the three anchors (rings whose hole
 * filled in, in a small, dim or over-burned picture) form Ls too, and none, or
 * more than one, labels the rings in a way the target's layout allows.
 */
export type TargetMatchFailure =
  | 'anchors-not-found'
  | 'anchors-unclear'
  | 'mirrored-image'
  | 'too-few-marks';

type Anchors = { readonly origin: RingMark; readonly x: RingMark; readonly y: RingMark };

type GrownGrid = {
  readonly grid: Map<string, RingMark>;
  /** Rings the labelling puts on cells the layout does not have. */
  readonly outside: number;
  readonly mirrored: boolean;
};

const MAX_ANCHOR_CANDIDATES = 60;
const MAX_L_SCORE = 0.6;
const MAX_L_TRIALS = 400;
const ACCEPT_RADIUS_SHARE = 0.35;
const MIN_AREA_RATIO = 0.4;
const MAX_AREA_RATIO = 2.5;
const MIN_MATCHED = 8;
const MIN_MATCHED_SHARE = 0.25;
// Arms nearer parallel than this are no L under any laser camera's perspective.
const MAX_ARM_COSINE = 0.9;
// A combination of the arms this much shorter than an arm means the arm is
// not one grid step but several (a skewed L); slack for perspective.
const REDUCED_SLACK = 0.9;
// A mark this close (in arm lengths) to a half step means the arms skip it.
const HALF_STEP_SHARE = 0.25;
// The grid is grown this many cells past the layout's edge, where a ring can
// only be found when the labelling is wrong.
const GROW_PAST_EDGE = 2;
// Another labelling this close in size to the best one leaves it in doubt.
const RIVAL_SHARE = 0.05;
const MIN_RIVAL_GAP = 2;
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function matchBedTarget(
  rings: ReadonlyArray<RingMark>,
  layout: BedTargetLayout,
): TargetMatch {
  const candidates = anchorCandidates(
    rings.filter((r) => r.anchor),
    rings.filter((r) => !r.anchor),
  );
  if (candidates.length === 0) return { kind: 'failed', reason: 'anchors-not-found' };
  // Stray discs can form an L too, and every L of grid steps grows a grid as
  // large as the true one, labelling every ring wrongly while the fit still
  // looks clean. The true L is the one whose grid stays inside the layout, and
  // it must beat every other such labelling plainly. Growing does not depend
  // on handedness, so a mirrored image still grows its full grid, which is how
  // it is recognised.
  const grown: GrownGrid[] = candidates.map((anchors) => ({
    ...growGrid(rings, layout, anchors),
    mirrored:
      cross(subtractPoints(anchors.x, anchors.origin), subtractPoints(anchors.y, anchors.origin)) <
      0,
  }));
  const needed = Math.max(MIN_MATCHED, Math.ceil(MIN_MATCHED_SHARE * layout.marks.length));
  const largest = maxOf(grown.map((g) => g.grid.size));
  if (largest < needed) return { kind: 'failed', reason: 'too-few-marks' };
  const fitting = grown.filter((g) => g.outside === 0);
  const best = fitting.reduce<GrownGrid | null>(
    (most, g) => (most === null || g.grid.size > most.grid.size ? g : most),
    null,
  );
  // A disc where the labelling expects a ring is a ring whose hole filled in;
  // then the true third anchor may be such a ring too, and a turned L of
  // filled rings fits a square layout exactly. The photo cannot say which.
  if (best === null || hasRival(fitting, best) || discsOffAnchorCells(best.grid)) {
    return { kind: 'failed', reason: 'anchors-unclear' };
  }
  if (best.grid.size < needed) return { kind: 'failed', reason: 'too-few-marks' };
  if (best.mirrored) return { kind: 'failed', reason: 'mirrored-image' };
  const { grid } = best;
  const correspondences: TargetCorrespondence[] = [];
  for (const mark of layout.marks) {
    const found = grid.get(key(mark.col, mark.row));
    if (found !== undefined) correspondences.push({ mark, pixel: { x: found.x, y: found.y } });
  }
  return { kind: 'ok', correspondences, expected: layout.marks.length };
}

// Plausible Ls, best first: origin, the one-step x arm and the two-step y
// arm, roughly square, with the one-step arm as long as the distance to the
// nearest ring. A tilted camera shortens the steps along one axis, so an L
// that fails that is also scored by the rings its arms predict (latticeScore).
function anchorCandidates(
  discs: ReadonlyArray<RingMark>,
  rings: ReadonlyArray<RingMark>,
): Anchors[] {
  if (discs.length < 3 || discs.length > MAX_ANCHOR_CANDIDATES) return [];
  const marks = [...rings, ...discs];
  const scored: Array<{ readonly score: number; readonly anchors: Anchors }> = [];
  for (const origin of discs) {
    const step = nearestDistance(rings, origin);
    for (const x of discs) {
      for (const y of discs) {
        if (x === origin || y === origin || x === y) continue;
        let score = lScore(origin, x, y) + Math.abs(distance(x, origin) / step - 1);
        if (score >= MAX_L_SCORE) score = latticeScore(rings, origin, x, y);
        if (score < MAX_L_SCORE && armsAreGridSteps(marks, origin, x, y)) {
          scored.push({ score, anchors: { origin, x, y } });
        }
      }
    }
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_L_TRIALS)
    .map((s) => s.anchors);
}

function nearestDistance(rings: ReadonlyArray<RingMark>, from: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (const ring of rings) best = Math.min(best, distance(ring, from));
  return best;
}

// How far the rings the arms predict are from where the arms put them, in
// steps: the ring one short arm behind the origin and the ring halfway along
// the long arm. Every target has both (bed-target.ts), and the prediction
// holds at any camera tilt, where the arms' lengths and angle do not.
function latticeScore(rings: ReadonlyArray<RingMark>, origin: Vec2, x: Vec2, y: Vec2): number {
  const arm = subtractPoints(x, origin);
  const half = scalePoint(subtractPoints(y, origin), 0.5);
  const behind = subtractPoints(origin, arm);
  const middle = { x: origin.x + half.x, y: origin.y + half.y };
  const armLength = Math.hypot(arm.x, arm.y);
  const halfLength = Math.hypot(half.x, half.y);
  if (armLength === 0 || halfLength === 0) return Number.POSITIVE_INFINITY;
  return nearestDistance(rings, behind) / armLength + nearestDistance(rings, middle) / halfLength;
}

// The short arm and half the long arm must be single grid steps along two
// different axes: not near parallel, no shorter combination of them (a skewed
// pair such as one step and two-across-one-down passes latticeScore, since
// both land on rings), and no mark half a step along either arm or their
// diagonals (a diagonal pair spans only every other ring). The test is on
// lengths in the picture, so it holds under the perspective of a tilted camera.
function armsAreGridSteps(marks: ReadonlyArray<RingMark>, origin: Vec2, x: Vec2, y: Vec2): boolean {
  const arm = subtractPoints(x, origin);
  const half = scalePoint(subtractPoints(y, origin), 0.5);
  const armLength = Math.hypot(arm.x, arm.y);
  const halfLength = Math.hypot(half.x, half.y);
  if (armLength === 0 || halfLength === 0) return false;
  const cosine = Math.abs(arm.x * half.x + arm.y * half.y) / (armLength * halfLength);
  if (cosine > MAX_ARM_COSINE) return false;
  for (const k of [-2, -1, 1, 2]) {
    if (Math.hypot(half.x - k * arm.x, half.y - k * arm.y) < REDUCED_SLACK * halfLength) {
      return false;
    }
    if (Math.hypot(arm.x - k * half.x, arm.y - k * half.y) < REDUCED_SLACK * armLength) {
      return false;
    }
  }
  const reach = HALF_STEP_SHARE * Math.min(armLength, halfLength);
  const halfSteps = [
    scalePoint(arm, 0.5),
    scalePoint(half, 0.5),
    scalePoint({ x: arm.x + half.x, y: arm.y + half.y }, 0.5),
    scalePoint({ x: arm.x - half.x, y: arm.y - half.y }, 0.5),
  ];
  return halfSteps.every(
    (step) => nearestDistance(marks, { x: origin.x + step.x, y: origin.y + step.y }) > reach,
  );
}

const ANCHOR_CELLS: ReadonlySet<string> = new Set([key(0, 0), key(1, 0), key(0, 2)]);

function discsOffAnchorCells(grid: ReadonlyMap<string, RingMark>): boolean {
  return [...grid].some(([cell, mark]) => mark.anchor && !ANCHOR_CELLS.has(cell));
}

// True when another labelling of the rings grows nearly as large a grid as
// the best one: which is right is then a guess.
function hasRival(grids: ReadonlyArray<GrownGrid>, best: GrownGrid): boolean {
  const gap = Math.max(MIN_RIVAL_GAP, Math.ceil(RIVAL_SHARE * best.grid.size));
  const cellOf = new Map<RingMark, string>();
  for (const [cell, ring] of best.grid) cellOf.set(ring, cell);
  return grids.some(
    (other) =>
      other !== best &&
      other.grid.size >= best.grid.size - gap &&
      [...other.grid].some(([cell, ring]) => {
        const there = cellOf.get(ring);
        return there !== undefined && there !== cell;
      }),
  );
}

function lScore(origin: Vec2, x: Vec2, y: Vec2): number {
  const vx = subtractPoints(x, origin);
  const vy = subtractPoints(y, origin);
  const lx = Math.hypot(vx.x, vx.y);
  const ly = Math.hypot(vy.x, vy.y);
  if (lx === 0 || ly === 0) return Number.POSITIVE_INFINITY;
  const cosine = Math.abs((vx.x * vy.x + vx.y * vy.y) / (lx * ly));
  return cosine + Math.abs(ly / lx / 2 - 1);
}

// The grid grown from `anchors`, a little past the layout's edge so that a
// wrong labelling shows itself by finding rings where the layout has none.
function growGrid(
  rings: ReadonlyArray<RingMark>,
  layout: BedTargetLayout,
  anchors: Anchors,
): Omit<GrownGrid, 'mirrored'> {
  const layoutCells = new Set(layout.marks.map((m) => key(m.col, m.row)));
  const cols = layout.marks.map((m) => m.col);
  const rows = layout.marks.map((m) => m.row);
  const minCol = minOf(cols) - GROW_PAST_EDGE;
  const maxCol = maxOf(cols) + GROW_PAST_EDGE;
  const minRow = minOf(rows) - GROW_PAST_EDGE;
  const maxRow = maxOf(rows) + GROW_PAST_EDGE;
  const reachable = (col: number, row: number): boolean =>
    col >= minCol && col <= maxCol && row >= minRow && row <= maxRow;
  const ringsOnly = rings.filter((ring) => !ring.anchor);
  const grid = new Map<string, RingMark>();
  const used = new Set<RingMark>();
  const place = (col: number, row: number, ring: RingMark) => {
    grid.set(key(col, row), ring);
    used.add(ring);
  };
  place(0, 0, anchors.origin);
  place(1, 0, anchors.x);
  place(0, 2, anchors.y);
  const queue: Array<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [0, 2],
  ];
  const fallback = {
    x: subtractPoints(anchors.x, anchors.origin),
    y: scalePoint(subtractPoints(anchors.y, anchors.origin), 0.5),
  };
  // The queue grows while it is walked: a breadth-first fill outward.
  for (const [col, row] of queue) {
    for (const [dc, dr] of DIRECTIONS) {
      const target = key(col + dc, row + dr);
      if (!reachable(col + dc, row + dr) || grid.has(target)) continue;
      // Past the layout only a real ring is evidence: a solid blob of bed
      // just beyond the sheet's edge often sits a step from the last ring.
      const candidates = layoutCells.has(target) ? rings : ringsOnly;
      const ring = findNeighbour(candidates, used, grid, fallback, col, row, dc, dr);
      if (ring === null) continue;
      place(col + dc, row + dr, ring);
      queue.push([col + dc, row + dr]);
    }
  }
  let outside = 0;
  for (const cell of [...grid.keys()]) {
    if (layoutCells.has(cell)) continue;
    outside += 1;
    grid.delete(cell);
  }
  return { grid, outside };
}

function findNeighbour(
  rings: ReadonlyArray<RingMark>,
  used: ReadonlySet<RingMark>,
  grid: ReadonlyMap<string, RingMark>,
  fallback: { readonly x: Vec2; readonly y: Vec2 },
  col: number,
  row: number,
  dc: number,
  dr: number,
): RingMark | null {
  const from = grid.get(key(col, row)) as RingMark;
  const step = localStep(grid, fallback, col, row, dc, dr);
  const predicted = { x: from.x + step.x, y: from.y + step.y };
  const radius = ACCEPT_RADIUS_SHARE * Math.hypot(step.x, step.y);
  let best: RingMark | null = null;
  let bestDistance = radius;
  for (const ring of rings) {
    if (used.has(ring)) continue;
    const ratio = ring.area / from.area;
    if (ratio < MIN_AREA_RATIO || ratio > MAX_AREA_RATIO) continue;
    const distance = Math.hypot(ring.x - predicted.x, ring.y - predicted.y);
    if (distance < bestDistance) {
      best = ring;
      bestDistance = distance;
    }
  }
  return best;
}

// Continue the same line when the previous mark on it is known; otherwise
// borrow the step from the nearest known parallel neighbour, then the anchors.
function localStep(
  grid: ReadonlyMap<string, RingMark>,
  fallback: { readonly x: Vec2; readonly y: Vec2 },
  col: number,
  row: number,
  dc: number,
  dr: number,
): Vec2 {
  const here = grid.get(key(col, row)) as RingMark;
  const behind = grid.get(key(col - dc, row - dr));
  if (behind !== undefined) return subtractPoints(here, behind);
  const ahead = grid.get(key(col + 2 * dc, row + 2 * dr));
  if (ahead !== undefined) return scalePoint(subtractPoints(ahead, here), 0.5);
  for (const side of [-1, 1]) {
    const a = grid.get(key(col + side * dr, row + side * dc));
    const b = grid.get(key(col + side * dr + dc, row + side * dc + dr));
    if (a !== undefined && b !== undefined) return subtractPoints(b, a);
  }
  const unit = dc !== 0 ? fallback.x : fallback.y;
  return scalePoint(unit, dc !== 0 ? dc : dr);
}

function key(col: number, row: number): string {
  return `${col},${row}`;
}
