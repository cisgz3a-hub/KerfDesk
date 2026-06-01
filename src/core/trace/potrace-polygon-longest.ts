import {
  cyclic,
  directionIndex,
  mod,
  pointAt,
  sign,
  xprod,
  type PotracePoint,
} from './potrace-polygon-core';

type DirectionCounts = [number, number, number, number];
type ConstraintPair = [PotracePoint, PotracePoint];

type PivotSearchResult = {
  readonly found: boolean;
  readonly pivot: number;
  readonly k: number;
  readonly previousK: number;
  readonly constraints: ConstraintPair;
};

export function calculatePotraceLongestStraightSegments(points: readonly PotracePoint[]): number[] {
  const n = points.length;
  if (n === 0) return [];

  const pivot = new Array<number>(n).fill(0);
  const nextCorner = buildNextCorners(points);
  const lon = new Array<number>(n).fill(0);

  for (let i = n - 1; i >= 0; i -= 1) {
    const result = findPivot(points, nextCorner, i);
    pivot[i] = result.found ? result.pivot : finishPivot(points, i, result);
  }

  return buildLongestSegments(n, pivot, lon);
}

function buildNextCorners(points: readonly PotracePoint[]): number[] {
  const n = points.length;
  const nextCorner = new Array<number>(n).fill(0);
  let k = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const current = pointAt(points, i);
    const pivot = pointAt(points, k);
    if (current.x !== pivot.x && current.y !== pivot.y) k = i + 1;
    nextCorner[i] = k;
  }
  return nextCorner;
}

function findPivot(
  points: readonly PotracePoint[],
  nextCorner: readonly number[],
  i: number,
): PivotSearchResult {
  const counts = initialDirectionCounts(points, i);
  const constraints: ConstraintPair = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  let k = nextCorner[i] ?? 0;
  let previousK = i;

  while (true) {
    addDirection(counts, directionBetween(points, previousK, k));
    if (allDirectionsSeen(counts))
      return { found: true, pivot: previousK, k, previousK, constraints };

    const current = vectorFrom(points, i, k);
    if (violatesConstraints(constraints, current)) break;
    tightenConstraints(constraints, current);

    previousK = k;
    k = nextCorner[previousK] ?? 0;
    if (!cyclic(k, i, previousK)) break;
  }

  return { found: false, pivot: previousK, k, previousK, constraints };
}

function initialDirectionCounts(points: readonly PotracePoint[], i: number): DirectionCounts {
  const counts: DirectionCounts = [0, 0, 0, 0];
  addDirection(counts, directionBetween(points, i, mod(i + 1, points.length)));
  return counts;
}

function directionBetween(points: readonly PotracePoint[], from: number, to: number): number {
  return directionIndex(
    pointAt(points, to).x - pointAt(points, from).x,
    pointAt(points, to).y - pointAt(points, from).y,
  );
}

function addDirection(counts: DirectionCounts, direction: number): void {
  counts[direction] = (counts[direction] ?? 0) + 1;
}

function allDirectionsSeen(counts: DirectionCounts): boolean {
  return counts.every((count) => count > 0);
}

function vectorFrom(points: readonly PotracePoint[], origin: number, target: number): PotracePoint {
  return {
    x: pointAt(points, target).x - pointAt(points, origin).x,
    y: pointAt(points, target).y - pointAt(points, origin).y,
  };
}

function violatesConstraints(constraints: ConstraintPair, current: PotracePoint): boolean {
  return xprod(constraints[0], current) < 0 || xprod(constraints[1], current) > 0;
}

function tightenConstraints(constraints: ConstraintPair, current: PotracePoint): void {
  if (Math.abs(current.x) <= 1 && Math.abs(current.y) <= 1) return;

  const lower = lowerOffset(current);
  if (xprod(constraints[0], lower) >= 0) constraints[0] = lower;

  const upper = upperOffset(current);
  if (xprod(constraints[1], upper) <= 0) constraints[1] = upper;
}

function lowerOffset(current: PotracePoint): PotracePoint {
  return {
    x: current.x + (current.y >= 0 && (current.y > 0 || current.x < 0) ? 1 : -1),
    y: current.y + (current.x <= 0 && (current.x < 0 || current.y < 0) ? 1 : -1),
  };
}

function upperOffset(current: PotracePoint): PotracePoint {
  return {
    x: current.x + (current.y <= 0 && (current.y < 0 || current.x < 0) ? 1 : -1),
    y: current.y + (current.x >= 0 && (current.x > 0 || current.y < 0) ? 1 : -1),
  };
}

function finishPivot(
  points: readonly PotracePoint[],
  i: number,
  result: PivotSearchResult,
): number {
  const n = points.length;
  const direction = {
    x: sign(pointAt(points, result.k).x - pointAt(points, result.previousK).x),
    y: sign(pointAt(points, result.k).y - pointAt(points, result.previousK).y),
  };
  const current = {
    x: pointAt(points, result.previousK).x - pointAt(points, i).x,
    y: pointAt(points, result.previousK).y - pointAt(points, i).y,
  };
  const advance = pivotAdvance(result.constraints, current, direction);
  return mod(result.previousK + advance, n);
}

function pivotAdvance(
  constraints: ConstraintPair,
  current: PotracePoint,
  direction: PotracePoint,
): number {
  const a = xprod(constraints[0], current);
  const b = xprod(constraints[0], direction);
  const c = xprod(constraints[1], current);
  const d = xprod(constraints[1], direction);
  let advance = 10_000_000;
  if (b < 0) advance = Math.floor(a / -b);
  if (d > 0) advance = Math.min(advance, Math.floor(-c / d));
  return advance;
}

function buildLongestSegments(n: number, pivot: readonly number[], lon: number[]): number[] {
  let j = pivot[n - 1] ?? 0;
  lon[n - 1] = j;
  for (let i = n - 2; i >= 0; i -= 1) {
    if (cyclic(i + 1, pivot[i] ?? 0, j)) j = pivot[i] ?? 0;
    lon[i] = j;
  }

  for (let i = n - 1; cyclic(mod(i + 1, n), j, lon[i] ?? 0); i -= 1) {
    lon[i] = j;
    if (i === 0) break;
  }

  return lon;
}
