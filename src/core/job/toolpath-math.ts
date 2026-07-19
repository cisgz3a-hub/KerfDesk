// Toolpath math helpers — shared Euclidean primitives for the build, raster,
// and slice modules. Pure; split from toolpath.ts (Phase H.2 refactor).

import type { Vec2 } from '../scene';
import type { ToolpathStep, TravelMotion } from './toolpath-types';

export function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function polylineLength(polyline: ReadonlyArray<Vec2>): number {
  let len = 0;
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1];
    const b = polyline[i];
    if (a === undefined || b === undefined) continue;
    len += dist(a, b);
  }
  return len;
}

export function appendTravelStep(
  steps: ToolpathStep[],
  from: Vec2 | null,
  to: Vec2,
  motion?: TravelMotion,
): void {
  if (from === null || (from.x === to.x && from.y === to.y)) return;
  steps.push({
    kind: 'travel',
    from,
    to,
    length: dist(from, to),
    ...(motion === undefined ? {} : { motion }),
  });
}
