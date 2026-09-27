// A waterline contour as cutter motion (ADR-423). The contour's vertices are
// exact (relief-waterline-contours.ts); this drops the vertices a straight
// move can replace and checks every move it emits.
//
// A move is checked by the exact tip at its middle and at points no more than
// a quarter cell apart along it. Reduction (Douglas-Peucker) replaces a run of
// vertices with one move only when every dropped vertex lies within the
// tolerance of it and the move passes the check. A move between two
// neighbouring vertices that fails it (it reaches into the wall by more than
// the 0.001 mm emit grid) gets a vertex at the failing point nearest its
// middle, pushed off the wall until the tip clears it (or, failing that within
// half a cell, lifted to the tip), and both halves are checked again. A move
// still failing after MAX_SPLIT_DEPTH splits is lifted over the model instead,
// so no move is emitted unchecked.

import type { FinishingPoint } from './relief-finishing-path';
import type { WaterlinePoint, WaterlineSurface } from './relief-waterline-contours';

// A move that fails its check is split at most this many times (into at most
// 16 moves); past that it is lifted, which only a pathological surface needs.
const MAX_SPLIT_DEPTH = 4;
// How far a move between exact vertices may reach into a wall, sideways: the
// 0.001 mm grid G-code coordinates are written on. A convex contour's chord
// always reaches in a little (a 0.28 mm chord of a 1.6 mm ball's corner arc
// by 0.006 mm), so an exact rule would split every move on a curve.
const WALL_REACH_MM = 0.001;
const PUSH_BISECTIONS = 20;

export type WaterlinePathOptions = {
  readonly z: number;
  readonly surface: WaterlineSurface;
  // Longest unchecked stretch of a move: a quarter heightmap cell.
  readonly checkSpacingMm: number;
  readonly toleranceMm: number;
};

export function waterlinePath(
  points: ReadonlyArray<WaterlinePoint>,
  closed: boolean,
  options: WaterlinePathOptions,
): ReadonlyArray<FinishingPoint> {
  const first = points[0];
  if (first === undefined) return [];
  const open = closed ? [...points, first] : points;
  return reduce(
    open.map((point) => ({ x: point.x, y: point.y, z: options.z })),
    options,
  );
}

// Appends `to` after `from`, first adding cleared vertices wherever the move
// between them would stand below the tip.
function appendCheckedMove(
  out: FinishingPoint[],
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlinePathOptions,
  depth: number,
): void {
  const failure = failureNearMiddle(from, to, options);
  if (failure === null) {
    out.push(to);
    return;
  }
  if (depth >= MAX_SPLIT_DEPTH) {
    out.push(...liftedMove(from, to, options));
    return;
  }
  const middle = clearedPoint(failure, from, to, options);
  appendCheckedMove(out, from, middle, options, depth + 1);
  appendCheckedMove(out, middle, to, options, depth + 1);
}

// The checked point of the move nearest its middle that reaches into the wall
// by more than the emit grid: the tip must clear it once it is moved that far
// off the wall. Splitting there halves a chord across a curve.
function failureNearMiddle(
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlinePathOptions,
): FinishingPoint | null {
  const steps = checkSteps(from, to, options);
  const half = Math.floor(steps / 2);
  for (let offset = 0; offset < steps; offset += 1) {
    // half, half + 1, half - 1, half + 2, ...
    const step = offset % 2 === 0 ? half - offset / 2 : half + (offset + 1) / 2;
    if (step < 1 || step >= steps) continue;
    const point = lerp(from, to, step / steps);
    if (!clearsBesideWall(point, from, to, options)) return point;
  }
  return null;
}

function firstFailure(
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlinePathOptions,
): FinishingPoint | null {
  const steps = checkSteps(from, to, options);
  for (let step = 1; step < steps; step += 1) {
    const point = lerp(from, to, step / steps);
    if (!clearsBesideWall(point, from, to, options)) return point;
  }
  return null;
}

// Every move is checked at least at its middle, however short; a vertical
// move has no sideways reach and its ends are already clear.
function checkSteps(
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlinePathOptions,
): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 0 ? Math.max(2, Math.ceil(length / options.checkSpacingMm)) : 0;
}

function clearsBesideWall(
  point: FinishingPoint,
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlinePathOptions,
): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const nx = (-(to.y - from.y) / length) * WALL_REACH_MM;
  const ny = ((to.x - from.x) / length) * WALL_REACH_MM;
  return options.surface.clears(point.x + nx, point.y + ny, point.z);
}

// The move raised to the highest tip checked along it: up, across, down. Both
// ends already clear the model, so the vertical moves cannot cut.
function liftedMove(
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlinePathOptions,
): ReadonlyArray<FinishingPoint> {
  const steps = Math.max(1, checkSteps(from, to, options));
  let z = Math.max(from.z, to.z);
  for (let step = 0; step <= steps; step += 1) {
    const point = lerp(from, to, step / steps);
    z = Math.max(z, options.surface.tipAt(point.x, point.y));
  }
  return [{ x: from.x, y: from.y, z }, { x: to.x, y: to.y, z }, to];
}

// `point` moved off the wall (left of travel, where the region lies) by the
// least distance, up to one check spacing, at which the tip clears it; lifted
// to the tip instead when no such distance exists.
function clearedPoint(
  point: FinishingPoint,
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlinePathOptions,
): FinishingPoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const nx = length > 0 ? -(to.y - from.y) / length : 0;
  const ny = length > 0 ? (to.x - from.x) / length : 0;
  const reach = 2 * options.checkSpacingMm;
  const clears = (distance: number): boolean =>
    options.surface.clears(point.x + distance * nx, point.y + distance * ny, point.z);
  if (length > 0 && clears(reach)) {
    let low = 0;
    let high = reach;
    for (let step = 0; step < PUSH_BISECTIONS; step += 1) {
      const middle = (low + high) / 2;
      if (clears(middle)) high = middle;
      else low = middle;
    }
    return { x: point.x + high * nx, y: point.y + high * ny, z: point.z };
  }
  return { ...point, z: Math.max(point.z, options.surface.tipAt(point.x, point.y)) };
}

// Douglas-Peucker over the checked path, accepting a move only when it also
// passes the check. Ranges are processed left to right from an explicit stack.
function reduce(
  points: ReadonlyArray<FinishingPoint>,
  options: WaterlinePathOptions,
): ReadonlyArray<FinishingPoint> {
  const first = points[0];
  if (first === undefined) return [];
  const out: FinishingPoint[] = [first];
  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() ?? [0, 0];
    const split = splitIndex(points, a, b, options);
    if (split !== null) {
      stack.push([split, b], [a, split]);
      continue;
    }
    const from = points[a];
    const to = points[b];
    if (from === undefined || to === undefined || a === b) continue;
    // A longer move passed its check in splitIndex; a neighbour move has not.
    if (b - a === 1) appendCheckedMove(out, from, to, options, 0);
    else out.push(to);
  }
  return out;
}

function splitIndex(
  points: ReadonlyArray<FinishingPoint>,
  a: number,
  b: number,
  options: WaterlinePathOptions,
): number | null {
  if (b - a < 2) return null;
  const from = points[a];
  const to = points[b];
  if (from === undefined || to === undefined) return null;
  let farthest = a + 1;
  let farthestDistance = -1;
  for (let k = a + 1; k < b; k += 1) {
    const point = points[k];
    if (point === undefined) continue;
    const distance = distanceToSegment(point, from, to);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthest = k;
    }
  }
  if (farthestDistance > options.toleranceMm) return farthest;
  return firstFailure(from, to, options) === null ? null : farthest;
}

function distanceToSegment(p: FinishingPoint, a: FinishingPoint, b: FinishingPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const t =
    lengthSquared > 0
      ? Math.min(
          1,
          Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lengthSquared),
        )
      : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy), p.z - (a.z + t * dz));
}

function lerp(a: FinishingPoint, b: FinishingPoint, t: number): FinishingPoint {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
}
