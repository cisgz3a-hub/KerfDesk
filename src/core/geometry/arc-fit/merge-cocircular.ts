// Joins consecutive fitted primitives that are one primitive in all but
// floating-point noise: arcs of the same circle turning the same way (a biarc
// on a traced circle lands both halves on it) and collinear lines running the
// same way. The joined primitive moves no point by more than the noise bound.

import type { Vec2 } from '../../scene';
import { ARC_FIT_MAX_SWEEP_RAD } from './arc-fit-limits';
import { arcAbout, type FitArc, type FitPrimitive } from './arc-primitives';

const SAME_GEOMETRY_MM = 1e-7;

export function mergeCocircular(primitives: ReadonlyArray<FitPrimitive>): FitPrimitive[] {
  const out: FitPrimitive[] = [];
  for (const primitive of primitives) {
    const previous = out[out.length - 1];
    const joined = previous === undefined ? null : joinPrimitives(previous, primitive);
    if (joined === null) out.push(primitive);
    else out[out.length - 1] = joined;
  }
  return out;
}

function joinPrimitives(first: FitPrimitive, second: FitPrimitive): FitPrimitive | null {
  if (first.kind === 'line' && second.kind === 'line')
    return joinLines(first.start, first.end, second.end);
  if (first.kind === 'arc' && second.kind === 'arc') return joinArcs(first, second);
  return null;
}

function joinLines(start: Vec2, middle: Vec2, end: Vec2): FitPrimitive | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const offset = ((middle.x - start.x) * dy - (middle.y - start.y) * dx) / length;
  const along = ((middle.x - start.x) * dx + (middle.y - start.y) * dy) / length;
  if (Math.abs(offset) > SAME_GEOMETRY_MM || along <= 0 || along >= length) return null;
  return { kind: 'line', start, end };
}

function joinArcs(first: FitArc, second: FitArc): FitPrimitive | null {
  if (first.clockwise !== second.clockwise) return null;
  if (first.sweep + second.sweep > ARC_FIT_MAX_SWEEP_RAD) return null;
  const centerGap = Math.hypot(first.center.x - second.center.x, first.center.y - second.center.y);
  if (centerGap > SAME_GEOMETRY_MM || Math.abs(first.radius - second.radius) > SAME_GEOMETRY_MM) {
    return null;
  }
  return arcAbout(first.start, second.end, first.center, first.clockwise);
}
