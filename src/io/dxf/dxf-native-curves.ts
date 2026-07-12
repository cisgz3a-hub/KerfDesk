import type { CubicPathSegment, CurveSubpath, Vec2 } from '../../core/scene';

const FULL_TURN = Math.PI * 2;
const MAX_CUBIC_SWEEP = Math.PI / 2;

export function ellipseArcCurve(
  center: Vec2,
  majorAxis: Vec2,
  ratio: number,
  startParam: number,
  sweep: number,
  closed: boolean,
): CurveSubpath {
  const minorAxis = { x: -majorAxis.y * ratio, y: majorAxis.x * ratio };
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_CUBIC_SWEEP));
  const delta = sweep / count;
  const segments: CubicPathSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const fromParam = startParam + index * delta;
    const toParam = fromParam + delta;
    segments.push(parametricEllipseCubic(center, majorAxis, minorAxis, fromParam, toParam));
  }
  return {
    start: ellipsePoint(center, majorAxis, minorAxis, startParam),
    segments,
    closed,
  };
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

function parametricEllipseCubic(
  center: Vec2,
  majorAxis: Vec2,
  minorAxis: Vec2,
  fromParam: number,
  toParam: number,
): CubicPathSegment {
  const delta = toParam - fromParam;
  const handle = (4 / 3) * Math.tan(delta / 4);
  const from = ellipsePoint(center, majorAxis, minorAxis, fromParam);
  const to = ellipsePoint(center, majorAxis, minorAxis, toParam);
  const fromDerivative = ellipseDerivative(majorAxis, minorAxis, fromParam);
  const toDerivative = ellipseDerivative(majorAxis, minorAxis, toParam);
  return {
    kind: 'cubic',
    control1: {
      x: from.x + handle * fromDerivative.x,
      y: from.y + handle * fromDerivative.y,
    },
    control2: {
      x: to.x - handle * toDerivative.x,
      y: to.y - handle * toDerivative.y,
    },
    to,
  };
}

function ellipsePoint(center: Vec2, majorAxis: Vec2, minorAxis: Vec2, t: number): Vec2 {
  return {
    x: center.x + majorAxis.x * Math.cos(t) + minorAxis.x * Math.sin(t),
    y: center.y + majorAxis.y * Math.cos(t) + minorAxis.y * Math.sin(t),
  };
}

function ellipseDerivative(majorAxis: Vec2, minorAxis: Vec2, t: number): Vec2 {
  return {
    x: -majorAxis.x * Math.sin(t) + minorAxis.x * Math.cos(t),
    y: -majorAxis.y * Math.sin(t) + minorAxis.y * Math.cos(t),
  };
}
