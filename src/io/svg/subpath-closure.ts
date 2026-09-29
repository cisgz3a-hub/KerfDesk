// Closes an imported contour whose ends meet but that the file did not close
// (E-2). Many exporters write a closed outline as a path that returns to its
// start without Z, or as a <polyline> whose last point repeats its first. Fill
// and preflight already treat such a contour as closed (isClosedEnough), while
// kerf, tabs, overcut, containment and weld read the `closed` flag, so the
// importer stores it exactly as Z or <polygon> would have.
//
// The test is isClosedEnough's: at least three points, and both axes within
// CLOSURE_EPS_MM. That tolerance is in document millimetres, but SVG geometry
// is still in user units here, so callers divide it by the element's largest
// user-to-mm stretch (the same divisor the curve flatness uses).

import type { Vec2 } from '../../core/scene';
import { CLOSURE_EPS_MM } from '../../core/scene/polyline-closure';

/** CLOSURE_EPS_MM in user units for an element whose largest user-to-mm stretch is `scale`. */
export function closureToleranceUserUnits(scale: number): number {
  return CLOSURE_EPS_MM / (Number.isFinite(scale) && scale > 0 ? scale : 1);
}

/** True when a contour of three or more points ends within `tolerance` of its start on both axes. */
export function endsMeet(points: ReadonlyArray<Vec2>, tolerance: number): boolean {
  const first = points[0];
  const last = points.at(-1);
  if (points.length < 3 || first === undefined || last === undefined) return false;
  return Math.abs(first.x - last.x) < tolerance && Math.abs(first.y - last.y) < tolerance;
}
