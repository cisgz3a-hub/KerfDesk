import {
  polylineToCurveSubpath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Vec2,
} from '../scene';
import { fitCentripetalCubics } from '../trace/centerline/curve-cubics';

const NEAR_POINT_EPSILON_MM = 1e-9;

/** Round a sparse pen chain with the tracer's centripetal spline engine. */
export function roundPolylineCurve(polyline: Polyline): CurveSubpath {
  const points = sourcePoints(polyline);
  const cubics = fitCentripetalCubics(points, polyline.closed);
  if (cubics.length === 0) return polylineToCurveSubpath(polyline);
  return {
    start: cubics[0]?.p0 ?? points[0] ?? { x: 0, y: 0 },
    closed: polyline.closed,
    segments: cubics.map<PathSegment>((cubic) => ({
      kind: 'cubic',
      control1: cubic.p1,
      control2: cubic.p2,
      to: cubic.p3,
    })),
  };
}

function sourcePoints(polyline: Polyline): ReadonlyArray<Vec2> {
  const unique = polyline.points.filter((point, index, points) => {
    const previous = points[index - 1];
    return previous === undefined || distance(point, previous) >= NEAR_POINT_EPSILON_MM;
  });
  if (!polyline.closed) return unique;
  const first = unique[0];
  const last = unique.at(-1);
  if (first === undefined || last === undefined) return unique;
  const isRepeatedStart = Math.hypot(last.x - first.x, last.y - first.y) < NEAR_POINT_EPSILON_MM;
  return isRepeatedStart ? unique.slice(0, -1) : unique;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
