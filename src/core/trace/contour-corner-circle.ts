// One-circle model for the corner dial (ADR-439): the algebraic least-squares
// circle (Kåsa 1976) through a run of crack points, used to tell a digitized
// or wobbly arc from a corner (contour-corner-legs.ts) and a circle's own
// digitization steps from drawn pixel detail (contour-corner-lattice.ts).

import type { Vec2 } from '../scene';
import { hypot2 } from '../geometry/fast-hypot';

export type FittedCircle = {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** RMS radial residual of the fitted points. */
  readonly rms: number;
};

/** Kåsa circle through `count` consecutive ring points from `start`; null
 *  when the points are (numerically) collinear. */
export function fitCircle(
  pts: ReadonlyArray<Vec2>,
  start: number,
  count: number,
): FittedCircle | null {
  const n = pts.length;
  const at = (k: number): Vec2 => pts[(((start + k) % n) + n) % n] as Vec2;
  let mx = 0;
  let my = 0;
  for (let k = 0; k < count; k += 1) {
    mx += at(k).x;
    my += at(k).y;
  }
  mx /= count;
  my /= count;
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (let k = 0; k < count; k += 1) {
    const u = at(k).x - mx;
    const v = at(k).y - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const r1 = 0.5 * (suuu + suvv);
  const r2 = 0.5 * (svvv + svuu);
  const uc = (r1 * svv - r2 * suv) / det;
  const vc = (r2 * suu - r1 * suv) / det;
  const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / count);
  let sumSq = 0;
  for (let k = 0; k < count; k += 1) {
    const d = hypot2(at(k).x - mx - uc, at(k).y - my - vc);
    sumSq += (d - radius) ** 2;
  }
  return { x: mx + uc, y: my + vc, radius, rms: Math.sqrt(sumSq / count) };
}
