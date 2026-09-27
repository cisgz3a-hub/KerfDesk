// Index detected rings onto the bed target grid (ADR-441). The anchor L gives
// the origin and one grid step along each axis; the grid then grows outward
// ring by ring, predicting each neighbour from the local step (so fisheye
// curvature is followed rather than fought) and accepting only a ring close
// to the prediction with a similar size. Pure core.

import type { BedTargetLayout, BedTargetMark } from './bed-target';
import type { RingMark } from './ring-detect';

type Vec2 = { readonly x: number; readonly y: number };

export type TargetCorrespondence = { readonly mark: BedTargetMark; readonly pixel: Vec2 };

export type TargetMatch =
  | {
      readonly kind: 'ok';
      readonly correspondences: ReadonlyArray<TargetCorrespondence>;
      readonly expected: number;
    }
  | { readonly kind: 'failed'; readonly reason: TargetMatchFailure };

export type TargetMatchFailure = 'anchors-not-found' | 'mirrored-image' | 'too-few-marks';

type Anchors = { readonly origin: RingMark; readonly x: RingMark; readonly y: RingMark };

const MAX_ANCHOR_CANDIDATES = 60;
const MAX_L_SCORE = 0.6;
const MAX_L_TRIALS = 400;
const ACCEPT_RADIUS_SHARE = 0.35;
const MIN_AREA_RATIO = 0.4;
const MAX_AREA_RATIO = 2.5;
const MIN_MATCHED = 8;
const MIN_MATCHED_SHARE = 0.25;
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
  // Stray blobs can form an L too; the true L is the one the grid agrees
  // with. Growing does not depend on handedness, so a mirrored image still
  // grows its full grid, which is how it is recognised.
  let grid = new Map<string, RingMark>();
  let mirrored = false;
  for (const anchors of candidates) {
    const grown = growGrid(rings, layout, anchors);
    if (grown.size <= grid.size) continue;
    grid = grown;
    mirrored = cross(sub(anchors.x, anchors.origin), sub(anchors.y, anchors.origin)) < 0;
  }
  const needed = Math.max(MIN_MATCHED, Math.ceil(MIN_MATCHED_SHARE * layout.marks.length));
  if (grid.size < needed) return { kind: 'failed', reason: 'too-few-marks' };
  if (mirrored) return { kind: 'failed', reason: 'mirrored-image' };
  const correspondences: TargetCorrespondence[] = [];
  for (const mark of layout.marks) {
    const found = grid.get(key(mark.col, mark.row));
    if (found !== undefined) correspondences.push({ mark, pixel: { x: found.x, y: found.y } });
  }
  return { kind: 'ok', correspondences, expected: layout.marks.length };
}

// Plausible Ls, best first: origin, the one-step x arm and the two-step y
// arm, roughly square, with the one-step arm as long as the distance to the
// nearest ring.
function anchorCandidates(
  discs: ReadonlyArray<RingMark>,
  rings: ReadonlyArray<RingMark>,
): Anchors[] {
  if (discs.length < 3 || discs.length > MAX_ANCHOR_CANDIDATES) return [];
  const scored: Array<{ readonly score: number; readonly anchors: Anchors }> = [];
  for (const origin of discs) {
    const step = nearestDistance(rings, origin);
    for (const x of discs) {
      for (const y of discs) {
        if (x === origin || y === origin || x === y) continue;
        const score = lScore(origin, x, y) + Math.abs(distance(x, origin) / step - 1);
        if (score < MAX_L_SCORE) scored.push({ score, anchors: { origin, x, y } });
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

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lScore(origin: Vec2, x: Vec2, y: Vec2): number {
  const vx = sub(x, origin);
  const vy = sub(y, origin);
  const lx = Math.hypot(vx.x, vx.y);
  const ly = Math.hypot(vy.x, vy.y);
  if (lx === 0 || ly === 0) return Number.POSITIVE_INFINITY;
  const cosine = Math.abs((vx.x * vy.x + vx.y * vy.y) / (lx * ly));
  return cosine + Math.abs(ly / lx / 2 - 1);
}

function growGrid(
  rings: ReadonlyArray<RingMark>,
  layout: BedTargetLayout,
  anchors: Anchors,
): Map<string, RingMark> {
  const exists = new Set(layout.marks.map((m) => key(m.col, m.row)));
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
    x: sub(anchors.x, anchors.origin),
    y: scale(sub(anchors.y, anchors.origin), 0.5),
  };
  // The queue grows while it is walked: a breadth-first fill outward.
  for (const [col, row] of queue) {
    for (const [dc, dr] of DIRECTIONS) {
      const target = key(col + dc, row + dr);
      if (!exists.has(target) || grid.has(target)) continue;
      const ring = findNeighbour(rings, used, grid, fallback, col, row, dc, dr);
      if (ring === null) continue;
      place(col + dc, row + dr, ring);
      queue.push([col + dc, row + dr]);
    }
  }
  return grid;
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
  if (behind !== undefined) return sub(here, behind);
  const ahead = grid.get(key(col + 2 * dc, row + 2 * dr));
  if (ahead !== undefined) return scale(sub(ahead, here), 0.5);
  for (const side of [-1, 1]) {
    const a = grid.get(key(col + side * dr, row + side * dc));
    const b = grid.get(key(col + side * dr + dc, row + side * dc + dr));
    if (a !== undefined && b !== undefined) return sub(b, a);
  }
  const unit = dc !== 0 ? fallback.x : fallback.y;
  return scale(unit, dc !== 0 ? dc : dr);
}

function key(col: number, row: number): string {
  return `${col},${row}`;
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}
