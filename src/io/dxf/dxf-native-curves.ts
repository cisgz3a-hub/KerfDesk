import { parametricEllipseCurve } from '../../core/geometry';
import type { CurveSubpath, Vec2 } from '../../core/scene';

const FULL_TURN = Math.PI * 2;

export function ellipseArcCurve(
  center: Vec2,
  majorAxis: Vec2,
  ratio: number,
  startParam: number,
  sweep: number,
  closed: boolean,
): CurveSubpath {
  return parametricEllipseCurve({
    center,
    majorAxis,
    ratio,
    startParam,
    sweep,
    closed,
  });
}

export function circleCurve(center: Vec2, radius: number): CurveSubpath {
  return ellipseArcCurve(center, { x: radius, y: 0 }, 1, 0, FULL_TURN, true);
}

export function bulgeCurveSegment(from: Vec2, to: Vec2, bulge: number): CurveSubpath['segments'] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return [];
  if (bulge === 0) return [{ kind: 'line', to }];
  const sweep = 4 * Math.atan(bulge);
  const radius = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  const centerOffset = chord / (2 * Math.tan(sweep / 2));
  const center = {
    x: (from.x + to.x) / 2 + (-dy / chord) * centerOffset,
    y: (from.y + to.y) / 2 + (dx / chord) * centerOffset,
  };
  const start = Math.atan2(from.y - center.y, from.x - center.x);
  const segments = [
    ...ellipseArcCurve(center, { x: radius, y: 0 }, 1, start, sweep, false).segments,
  ];
  const last = segments.at(-1);
  if (last !== undefined) segments[segments.length - 1] = { ...last, to };
  return segments;
}
