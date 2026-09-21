import type { BrushCapsule } from './brush-index';
import type { LaserSecondPassPoint } from './types';

export type ParameterInterval = { readonly start: number; readonly end: number };
type DirectedLine = {
  readonly origin: LaserSecondPassPoint;
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
};

function clipped(start: number, end: number): ParameterInterval | null {
  const lo = Math.max(0, start);
  const hi = Math.min(1, end);
  return hi > lo ? { start: lo, end: hi } : null;
}

function discInterval(
  line: DirectedLine,
  centre: LaserSecondPassPoint,
  radius: number,
): ParameterInterval | null {
  const x = centre.x - line.origin.x;
  const y = centre.y - line.origin.y;
  const along = x * line.dx + y * line.dy;
  const distance = Math.abs(x * line.dy - y * line.dx);
  if (!Number.isFinite(along) || !Number.isFinite(distance)) {
    throw new Error('Brush intersection exceeds the supported numeric range.');
  }
  if (distance >= radius) return null;
  // Normalisation avoids r*r overflow and preserves a diameter exactly when
  // distance is zero (sqrt(r) * sqrt(r) can expand it by an unnecessary ulp).
  const ratio = distance / radius;
  const half = radius * Math.sqrt((1 - ratio) * (1 + ratio));
  return clipped((along - half) / line.length, (along + half) / line.length);
}

function slab(
  interval: ParameterInterval,
  initial: number,
  delta: number,
  low: number,
  high: number,
): ParameterInterval | null {
  if (delta === 0) return initial >= low && initial <= high ? interval : null;
  const a = (low - initial) / delta;
  const b = (high - initial) / delta;
  return clipped(Math.max(interval.start, Math.min(a, b)), Math.min(interval.end, Math.max(a, b)));
}

function bodyInterval(line: DirectedLine, capsule: BrushCapsule): ParameterInterval | null {
  const cx = capsule.to.x - capsule.from.x;
  const cy = capsule.to.y - capsule.from.y;
  const length = Math.hypot(cx, cy);
  if (!Number.isFinite(length))
    throw new Error('Brush length exceeds the supported numeric range.');
  if (length === 0) return null;
  const ux = cx / length;
  const uy = cy / length;
  const x = line.origin.x - capsule.from.x;
  const y = line.origin.y - capsule.from.y;
  const along = x * ux + y * uy;
  const across = x * -uy + y * ux;
  const alongDelta = (line.dx * ux + line.dy * uy) * line.length;
  const acrossDelta = (line.dx * -uy + line.dy * ux) * line.length;
  if (![along, across, alongDelta, acrossDelta].every(Number.isFinite)) {
    throw new Error('Brush intersection exceeds the supported numeric range.');
  }
  const projected = slab({ start: 0, end: 1 }, along, alongDelta, 0, length);
  return projected === null
    ? null
    : slab(projected, across, acrossDelta, -capsule.radius, capsule.radius);
}

/** Exact line/round-capsule intersection, without sampling or polygonisation. */
export function capsuleInterval(
  from: LaserSecondPassPoint,
  to: LaserSecondPassPoint,
  capsule: BrushCapsule,
): ParameterInterval | null {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return null;
  const line = { origin: from, dx: (to.x - from.x) / length, dy: (to.y - from.y) / length, length };
  const pieces = [
    discInterval(line, capsule.from, capsule.radius),
    bodyInterval(line, capsule),
    discInterval(line, capsule.to, capsule.radius),
  ];
  let start = Infinity;
  let end = -Infinity;
  for (const piece of pieces) {
    if (piece === null) continue;
    start = Math.min(start, piece.start);
    end = Math.max(end, piece.end);
  }
  // A capsule is convex, so its nonempty intersection is one interval.
  return end > start ? { start, end } : null;
}
