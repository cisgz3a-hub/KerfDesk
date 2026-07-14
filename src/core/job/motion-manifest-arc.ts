import { sampleArcPoints } from '../geometry';
import type { MotionPoint } from './motion-manifest';

const EPSILON = 1e-9;
const FULL_TURN = Math.PI * 2;

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
  if (radius <= EPSILON) return null;
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
    return {
      x: args.from.x + (args.i ?? 0) * args.unitScale,
      y: args.from.y + (args.j ?? 0) * args.unitScale,
    };
  }
  if (args.r === undefined) return null;
  const radius = Math.abs(args.r) * args.unitScale;
  const dx = args.to.x - args.from.x;
  const dy = args.to.y - args.from.y;
  const chord = Math.hypot(dx, dy);
  if (chord <= EPSILON || radius + EPSILON < chord / 2) return null;
  const h = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const minor = args.r >= 0;
  const side = (args.clockwise ? -1 : 1) * (minor ? 1 : -1);
  return {
    x: args.from.x + dx / 2 + side * (-dy / chord) * h,
    y: args.from.y + dy / 2 + side * (dx / chord) * h,
  };
}

function arcSweep(
  start: number,
  end: number,
  clockwise: boolean,
  from: MotionPoint,
  to: MotionPoint,
): number {
  if (Math.hypot(from.x - to.x, from.y - to.y) <= EPSILON) {
    return clockwise ? -FULL_TURN : FULL_TURN;
  }
  let sweep = end - start;
  if (clockwise) while (sweep >= 0) sweep -= FULL_TURN;
  else while (sweep <= 0) sweep += FULL_TURN;
  return sweep;
}
