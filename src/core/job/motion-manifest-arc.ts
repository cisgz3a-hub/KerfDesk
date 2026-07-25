import { ARC_EPSILON, arcSweepAngle, ijArcCenter, rArcGeometry } from '../gcode';
import { sampleArcPoints } from '../geometry';
import type { MotionPoint } from './motion-manifest';

export function sampleMotionArc(args: {
  readonly from: MotionPoint;
  readonly to: MotionPoint;
  readonly clockwise: boolean;
  readonly i?: number;
  readonly j?: number;
  readonly r?: number;
  readonly unitScale: number;
}): ReadonlyArray<MotionPoint> | null {
  const center = arcCenter(args);
  if (center === null) return null;
  const radius = Math.hypot(args.from.x - center.x, args.from.y - center.y);
  if (radius <= ARC_EPSILON) return null;
  const start = Math.atan2(args.from.y - center.y, args.from.x - center.x);
  const end = Math.atan2(args.to.y - center.y, args.to.x - center.x);
  const sweep = arcSweep(start, end, args.clockwise, args.from, args.to);
  const xy = sampleArcPoints(center, radius, start, sweep);
  xy[xy.length - 1] = { x: args.to.x, y: args.to.y };
  const denominator = Math.max(1, xy.length - 1);
  return xy.map((point, index) => ({
    ...point,
    z: args.from.z + ((args.to.z - args.from.z) * index) / denominator,
  }));
}

// Geometry shared with the simulator parser (core/gcode); the drop-the-block
// policy on degenerate arcs is this module's own.
function arcCenter(args: {
  readonly from: MotionPoint;
  readonly to: MotionPoint;
  readonly clockwise: boolean;
  readonly i?: number;
  readonly j?: number;
  readonly r?: number;
  readonly unitScale: number;
}): { readonly x: number; readonly y: number } | null {
  if (args.i !== undefined || args.j !== undefined) {
    return ijArcCenter(args.from, args.i, args.j, args.unitScale);
  }
  if (args.r === undefined) return null;
  const solved = rArcGeometry(args.from, args.to, args.r, args.clockwise, args.unitScale);
  if (solved === null) return null;
  if (solved.radiusMm + ARC_EPSILON < solved.chordMm / 2) return null;
  return solved.center;
}

function arcSweep(
  start: number,
  end: number,
  clockwise: boolean,
  from: MotionPoint,
  to: MotionPoint,
): number {
  const samePoint = Math.hypot(from.x - to.x, from.y - to.y) <= ARC_EPSILON;
  return arcSweepAngle(start, end, clockwise, samePoint);
}
