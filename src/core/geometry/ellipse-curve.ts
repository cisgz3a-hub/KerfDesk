import type { CubicPathSegment, CurveSubpath, Vec2 } from '../scene';

const MAX_CUBIC_SWEEP = Math.PI / 2;

export function parametricEllipseCurve(args: {
  readonly center: Vec2;
  readonly majorAxis: Vec2;
  readonly ratio: number;
  readonly startParam: number;
  readonly sweep: number;
  readonly closed: boolean;
}): CurveSubpath {
  const { center, majorAxis, ratio, startParam, sweep, closed } = args;
  const minorAxis = { x: -majorAxis.y * ratio, y: majorAxis.x * ratio };
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_CUBIC_SWEEP));
  const delta = sweep / count;
  const segments: CubicPathSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const fromParam = startParam + index * delta;
    const toParam = fromParam + delta;
    segments.push(parametricEllipseCubic(center, majorAxis, minorAxis, fromParam, toParam));
  }
  const start = ellipsePoint(center, majorAxis, minorAxis, startParam);
  const last = segments.at(-1);
  if (closed && last !== undefined) segments[segments.length - 1] = { ...last, to: start };
  return {
    start,
    segments,
    closed,
  };
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
