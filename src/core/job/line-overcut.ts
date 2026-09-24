// Line-mode Overcut (ADR-385). LightBurn: "extend a cut by a specified
// amount past the end of closed shapes, on the final Pass"
// (https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/LineMode/).
//
// The overcut is not stored in the Job geometry. A group carries overcutMm
// and each emitter asks finalPassSegment for the extended polyline on its last
// pass only, so earlier passes, the planner, bounds and every consumer that
// reads segments see the cut exactly as compiled. The extension retraces the
// loop from its start in the cut direction, at the same power and speed.
//
// Only closed segments are extended. A shape that tabs split into open
// bridges ends at a tab gap, so overcutting it would cut the tab away; those
// bridges, and any open path, are left alone.

import type { Vec2 } from '../scene';
import type { LayerOperationSettings } from '../scene/layer';
import { closedLoopRing } from './closed-cut-loop';

// Operator-facing ceiling, far beyond any useful overlap. The emitted length
// is also capped at one perimeter, so a tiny shape is never circled twice.
export const MAX_LINE_OVERCUT_MM = 50;

const EPS = 1e-9;

/** The operation's overcut when it applies (Line mode, positive), else undefined. */
export function lineOvercutMm(
  layer: Pick<LayerOperationSettings, 'mode' | 'overcutMm'>,
): number | undefined {
  const value = layer.overcutMm;
  if (layer.mode !== 'line' || value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(value, MAX_LINE_OVERCUT_MM);
}

/**
 * The segment as the final pass cuts it: a closed loop followed by up to
 * `overcutMm` of the same loop again. Anything else comes back unchanged.
 */
export function finalPassSegment<
  T extends { readonly polyline: ReadonlyArray<Vec2>; readonly closed: boolean },
>(segment: T, overcutMm: number | undefined): T {
  if (overcutMm === undefined || !(overcutMm > 0) || !segment.closed) return segment;
  const tail = overcutTail(segment.polyline, overcutMm);
  if (tail.length === 0) return segment;
  // No longer a loop that ends where it starts: a consumer that re-closes
  // closed segments (the Ruida encoder does) must not add a chord back.
  return { ...segment, polyline: [...segment.polyline, ...tail], closed: false };
}

/** Points that retrace a closed polyline from its start for `lengthMm`. */
export function overcutTail(polyline: ReadonlyArray<Vec2>, lengthMm: number): ReadonlyArray<Vec2> {
  const ring = closedLoopRing(polyline);
  if (ring.length < 2) return [];
  const tail: Vec2[] = [];
  let remaining = Math.min(lengthMm, loopLength(ring));
  for (let i = 1; i <= ring.length && remaining > EPS; i += 1) {
    const from = ring[i - 1] as Vec2;
    const to = ring[i % ring.length] as Vec2;
    const edge = Math.hypot(to.x - from.x, to.y - from.y);
    if (edge <= EPS) continue;
    if (edge <= remaining + EPS) {
      tail.push(to);
      remaining -= edge;
      continue;
    }
    const t = remaining / edge;
    tail.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    remaining = 0;
  }
  return tail;
}

function loopLength(ring: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const from = ring[i] as Vec2;
    const to = ring[(i + 1) % ring.length] as Vec2;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}
