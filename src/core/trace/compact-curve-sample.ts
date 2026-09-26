// The compatibility polyline of a compact curve (ADR-440).
//
// These samples are the path's `polylines`, the view that older readers and
// previews use, and the first thing the contour topology repair tests. They
// are not what guards the curves: a cubic can cross or touch between its
// samples, so the repair also tests the curves themselves
// (compact-curve-contacts.ts, ADR-441), and the samples only need to stay
// close to the curve.

import type { CurveSubpath, Vec2 } from '../scene';
import { evaluateCubic } from '../geometry/cubic-fit';
import { cubicFlatnessSteps } from './compact-curve-shape';

// About one vertex per this many px along a cubic...
const SAMPLE_STEP_PX = 1.5;
// ...and never further than this from it, px.
const SAMPLE_FLATNESS_PX = 0.02;
const MIN_CUBIC_SAMPLES = 4;

/** The compatibility polyline of a compact curve: line ends only, about one
 *  vertex per 1.5 px along cubics and never more than 0.02 px from them,
 *  every joint exact. A closed curve's samples end on its start, as every
 *  closed trace ring does. */
export function sampleCompactCurve(curve: CurveSubpath): Vec2[] {
  const out: Vec2[] = [curve.start];
  let current = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') {
      const cubic = { p0: current, p1: segment.control1, p2: segment.control2, p3: segment.to };
      const length =
        Math.hypot(cubic.p1.x - cubic.p0.x, cubic.p1.y - cubic.p0.y) +
        Math.hypot(cubic.p2.x - cubic.p1.x, cubic.p2.y - cubic.p1.y) +
        Math.hypot(cubic.p3.x - cubic.p2.x, cubic.p3.y - cubic.p2.y);
      const steps = Math.max(
        MIN_CUBIC_SAMPLES,
        Math.ceil(length / SAMPLE_STEP_PX),
        cubicFlatnessSteps(cubic, SAMPLE_FLATNESS_PX),
      );
      for (let s = 1; s < steps; s += 1) out.push(evaluateCubic(cubic, s / steps));
    }
    out.push(segment.to);
    current = segment.to;
  }
  return out;
}
