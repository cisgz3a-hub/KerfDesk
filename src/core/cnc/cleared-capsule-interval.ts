import type { Vec2 } from '../scene';
import type { BoundarySegment } from './vcarve-detail-geometry';

export type UnitInterval = { readonly low: number; readonly high: number };

/** Exact line-parameter interval inside a constant-radius swept segment. */
export function clearedCapsuleInterval(
  a: Vec2,
  b: Vec2,
  segment: BoundarySegment,
  radiusMm: number,
): UnitInterval | null {
  if (!(radiusMm > 0)) return null;
  const dx = segment.bx - segment.ax;
  const dy = segment.by - segment.ay;
  const length = Math.hypot(dx, dy);
  const intervals = [
    circleInterval(a, b, segment.ax, segment.ay, radiusMm),
    circleInterval(a, b, segment.bx, segment.by, radiusMm),
  ];
  if (length > 0) {
    const ux = dx / length;
    const uy = dy / length;
    const qx = a.x - segment.ax;
    const qy = a.y - segment.ay;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const along = linearInterval(qx * ux + qy * uy, vx * ux + vy * uy, 0, length);
    const across = linearInterval(qx * uy - qy * ux, vx * uy - vy * ux, -radiusMm, radiusMm);
    if (along !== null && across !== null) {
      const low = Math.max(along.low, across.low);
      const high = Math.min(along.high, across.high);
      if (low <= high) intervals.push({ low, high });
    }
  }
  const parts = intervals.filter((part): part is UnitInterval => part !== null);
  // A capsule is convex, so its intersection with a chord is one interval.
  return parts.length === 0
    ? null
    : {
        low: Math.min(...parts.map((part) => part.low)),
        high: Math.max(...parts.map((part) => part.high)),
      };
}

function circleInterval(
  a: Vec2,
  b: Vec2,
  x: number,
  y: number,
  radius: number,
): UnitInterval | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const qx = a.x - x;
  const qy = a.y - y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength === 0) {
    return Math.hypot(qx, qy) <= radius ? { low: 0, high: 1 } : null;
  }
  const middle = -(qx * dx + qy * dy) / squaredLength;
  const closestX = qx + dx * middle;
  const closestY = qy + dy * middle;
  const reachSquared = radius * radius - closestX * closestX - closestY * closestY;
  if (reachSquared < 0) return null;
  const reach = Math.sqrt(reachSquared / squaredLength);
  const low = Math.max(0, middle - reach);
  const high = Math.min(1, middle + reach);
  return low <= high ? { low, high } : null;
}

function linearInterval(
  value: number,
  delta: number,
  min: number,
  max: number,
): UnitInterval | null {
  if (delta === 0) return value >= min && value <= max ? { low: 0, high: 1 } : null;
  const t0 = (min - value) / delta;
  const t1 = (max - value) / delta;
  const low = Math.max(0, Math.min(t0, t1));
  const high = Math.min(1, Math.max(t0, t1));
  return low <= high ? { low, high } : null;
}

export function mergeClearedIntervals(intervals: ReadonlyArray<UnitInterval>): UnitInterval[] {
  const merged: UnitInterval[] = [];
  for (const next of [...intervals].sort((a, b) => a.low - b.low || a.high - b.high)) {
    const previous = merged.at(-1);
    if (previous !== undefined && next.low <= previous.high) {
      merged[merged.length - 1] = { low: previous.low, high: Math.max(previous.high, next.high) };
    } else {
      merged.push(next);
    }
  }
  return merged;
}
