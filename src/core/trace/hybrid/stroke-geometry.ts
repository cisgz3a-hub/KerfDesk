// Small geometry shared by the Line + fill tracer (ADR-454).

import type { Vec2 } from '../../scene';

// Spacing (px) of the stroke samples that place a stroke's discs.
const DISC_STEP_PX = 0.5;

// Breadth-first eight-neighbour flood from `queue` (already claimed by the
// caller). `claim` returns true when it takes a neighbour into the region.
export function floodEightConnected(
  width: number,
  height: number,
  queue: number[],
  claim: (index: number) => boolean,
): void {
  // The array iterator reads the live length, so pushed pixels are visited.
  for (const i of queue) {
    const x = i % width;
    const y = (i - x) / width;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
        const n = ny * width + nx;
        if (claim(n)) queue.push(n);
      }
    }
  }
}

// The polyline's vertices plus points every half pixel along each segment: a
// straight stroke's fitted polyline is just its two ends, but every pixel it
// crosses needs its disc.
export function* densePoints(points: ReadonlyArray<Vec2>): Generator<Vec2> {
  const first = points[0];
  if (first !== undefined) yield first;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / DISC_STEP_PX);
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      yield { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
}

export function pathLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
