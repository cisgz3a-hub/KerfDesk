// A G17 I/J arc of the source program as the chords GRBL runs for it
// (ADR-407). KerfDesk's laser output writes G2/G3 on arc-enabled GRBL-family
// machines; the painted second pass repaints the path the controller
// executed, so it reads each arc as mc_arc's chords at the stock `$12` and
// refuses what GRBL refuses.

import { controllerArcChordPoints, GRBL_STOCK_ARC_TOLERANCE_MM } from '../geometry/arc-fit';
import type { LaserSecondPassPoint } from './types';

// GRBL's I/J arc check (gcode.c, gnea/grbl master): error 33 when the start
// and end radii differ by more than 0.005 mm and by more than 0.5 mm or 0.1%.
const ARC_RADIUS_ERROR_MM = 0.005;
const ARC_RADIUS_ERROR_MAX_MM = 0.5;
const ARC_RADIUS_ERROR_RELATIVE = 0.001;
// ARC_ANGULAR_TRAVEL_EPSILON in grbl/config.h (gnea/grbl master).
const ARC_ANGULAR_TRAVEL_EPSILON = 5e-7;

export type SourceArc = {
  readonly from: LaserSecondPassPoint;
  readonly target: LaserSecondPassPoint;
  readonly center: LaserSecondPassPoint;
  readonly clockwise: boolean;
};

/** The chord ends GRBL's mc_arc runs for `arc`, the last exactly its target. */
export function sourceArcChordEnds(arc: SourceArc): LaserSecondPassPoint[] {
  const { from, target, center } = arc;
  const rx = from.x - center.x;
  const ry = from.y - center.y;
  const tx = target.x - center.x;
  const ty = target.y - center.y;
  const radius = Math.hypot(rx, ry);
  if (!validArcRadius(radius, Math.abs(Math.hypot(tx, ty) - radius))) {
    throw new Error('Arc source move has an invalid centre for its end point.');
  }
  const travel = grblAngularTravel(rx, ry, tx, ty, arc.clockwise);
  const points = controllerArcChordPoints(
    center,
    radius,
    Math.atan2(ry, rx),
    travel,
    GRBL_STOCK_ARC_TOLERANCE_MM,
  );
  points[points.length - 1] = target;
  return points.slice(1);
}

function validArcRadius(radius: number, radiusError: number): boolean {
  if (!(radius > 0) || !Number.isFinite(radius)) return false;
  if (radiusError <= ARC_RADIUS_ERROR_MM) return true;
  return (
    radiusError <= ARC_RADIUS_ERROR_MAX_MM && radiusError <= ARC_RADIUS_ERROR_RELATIVE * radius
  );
}

// mc_arc: atan2 of the start and end radius vectors, pushed a full turn the
// commanded way when it reads the other way.
function grblAngularTravel(
  rx: number,
  ry: number,
  tx: number,
  ty: number,
  clockwise: boolean,
): number {
  const travel = Math.atan2(rx * ty - ry * tx, rx * tx + ry * ty);
  if (clockwise) return travel >= -ARC_ANGULAR_TRAVEL_EPSILON ? travel - 2 * Math.PI : travel;
  return travel <= ARC_ANGULAR_TRAVEL_EPSILON ? travel + 2 * Math.PI : travel;
}
