// Shared geometry for the centerline measurement harness. Pure, deterministic,
// test-only (lives under src/__fixtures__, boundary- and coverage-exempt per
// eslint.config.mjs). Used by both centerline-truth (ink predicates) and
// centerline-deviation (the pixel-accuracy metric).

import type { Polyline, Vec2 } from '../../core/scene';

// Squared distance from point p to segment [a,b]. Squared to avoid sqrt in the
// inner loop of the deviation scan; callers sqrt once at the end.
export function pointToSegmentDistanceSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  const raw = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const ex = p.x - (a.x + t * dx);
  const ey = p.y - (a.y + t * dy);
  return ex * ex + ey * ey;
}

// Minimum Euclidean distance from p to the nearest segment across every
// polyline. Returns Infinity when there are no segments (caller's concern).
export function minDistanceToPolylines(p: Vec2, polylines: ReadonlyArray<Polyline>): number {
  let bestSq = Number.POSITIVE_INFINITY;
  for (const pl of polylines) {
    const pts = pl.points;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a === undefined || b === undefined) continue;
      const d = pointToSegmentDistanceSq(p, a, b);
      if (d < bestSq) bestSq = d;
    }
  }
  return Math.sqrt(bestSq);
}

// Total arc length of an open polyline.
export function polylineLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// Resample a polyline to evenly spaced points (~`spacing` apart) so the
// deviation metric measures along the whole stroke, not just at vertices.
// Always includes the first point; emits subsequent points at each arc-length
// multiple of `spacing`.
export function sampleByArcLength(points: ReadonlyArray<Vec2>, spacing: number): Vec2[] {
  const start = points[0];
  if (start === undefined || spacing <= 0) return [];
  const out: Vec2[] = [{ x: start.x, y: start.y }];
  let nextAt = spacing;
  let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    while (segLen > 0 && nextAt <= acc + segLen) {
      const t = (nextAt - acc) / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      nextAt += spacing;
    }
    acc += segLen;
  }
  return out;
}
