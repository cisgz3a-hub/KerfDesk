// Arc-length geometry of one closed toolpath, shared by the holding-tab planner
// (cnc-tab-placement.ts) and its bridge measure (cnc-tab-bridge.ts), ADR-258
// Amendments 5 and 7.
//
// Pure: no clock, no randomness, no I/O.

import type { Vec2 } from '../scene';

const EPS = 1e-9;

export type TabLoop = {
  readonly points: ReadonlyArray<Vec2>;
  /** Arc length to each vertex; the last entry is the perimeter. */
  readonly cumulative: ReadonlyArray<number>;
  readonly perimeter: number;
};

/** An unwrapped arc-length interval of a loop: start <= end, either may pass 0 or the perimeter. */
export type ArcInterval = { readonly start: number; readonly end: number };

/** The closed loop `points` describe, or null when it has no length. */
export function tabLoop(rawPoints: ReadonlyArray<Vec2>): TabLoop | null {
  const points = closedLoopPoints(rawPoints);
  if (points.length < 3) return null;
  const cumulative: number[] = [0];
  for (let index = 1; index <= points.length; index += 1) {
    const previous = points[index - 1] as Vec2;
    const current = points[index % points.length] as Vec2;
    cumulative.push(
      (cumulative[index - 1] as number) +
        Math.hypot(current.x - previous.x, current.y - previous.y),
    );
  }
  const perimeter = cumulative[cumulative.length - 1] ?? 0;
  return perimeter > EPS ? { points, cumulative, perimeter } : null;
}

export function pointAtDistance(loop: TabLoop, distance: number): Vec2 {
  const { points, cumulative, perimeter } = loop;
  const target = modulo(distance, perimeter);
  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((cumulative[middle] as number) < target) low = middle + 1;
    else high = middle;
  }
  const from = cumulative[low - 1] as number;
  const span = (cumulative[low] as number) - from;
  const ratio = span <= EPS ? 0 : (target - from) / span;
  const a = points[low - 1] as Vec2;
  const b = points[low % points.length] as Vec2;
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}

// The windows as unwrapped arc-length intervals with overlaps merged, sorted
// by start, or 'whole' when together they cover the loop.
export function mergedWindows(
  centers: ReadonlyArray<number>,
  windowMm: number,
  perimeter: number,
): ReadonlyArray<ArcInterval> | 'whole' {
  if (centers.length === 0) return [];
  if (windowMm >= perimeter - EPS) return 'whole';
  const sorted = centers
    .map((center) => ({ start: center - windowMm / 2, end: center + windowMm / 2 }))
    .sort((a, b) => a.start - b.start);
  const merged: ArcInterval[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && window.start <= last.end + EPS) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, window.end) };
    } else {
      merged.push(window);
    }
  }
  const first = merged[0] as ArcInterval;
  const last = merged[merged.length - 1] as ArcInterval;
  if (merged.length > 1 && last.end + EPS >= first.start + perimeter) {
    merged[0] = { start: last.start - perimeter, end: first.end };
    merged.pop();
  }
  const only = merged[0] as ArcInterval;
  return merged.length === 1 && only.end - only.start >= perimeter - EPS ? 'whole' : merged;
}

export function circularGap(a: number, b: number, period: number): number {
  const gap = modulo(a - b, period);
  return Math.min(gap, period - gap);
}

export function modulo(value: number, divisor: number): number {
  if (!(divisor > 0)) return 0;
  return ((value % divisor) + divisor) % divisor;
}

// Drop a trailing vertex that repeats the first: callers hand us rings both with
// and without the explicit closing point.
function closedLoopPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  if (points.length < 2) return points;
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  const repeatsFirst = Math.abs(first.x - last.x) <= EPS && Math.abs(first.y - last.y) <= EPS;
  return repeatsFirst ? points.slice(0, -1) : points;
}
