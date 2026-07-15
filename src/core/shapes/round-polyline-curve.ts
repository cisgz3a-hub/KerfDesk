import {
  polylineToCurveSubpath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Vec2,
} from '../scene';
import { fitCubicsThroughPoints } from '../trace/fit-cubics';

const NEAR_POINT_EPSILON_MM = 1e-9;

/** Round a sparse pen chain with the tracer's least-squares cubic fitter. */
export function roundPolylineCurve(polyline: Polyline, fitToleranceMm: number): CurveSubpath {
  const points = sourcePoints(polyline);
  const measured = densifyChords(points, polyline.closed, Math.max(0.25, fitToleranceMm / 2));
  const cubics = fitCubicsThroughPoints(measured, polyline.closed, new Set(), fitToleranceMm);
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

function densifyChords(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  maximumStepMm: number,
): Vec2[] {
  const measured: Vec2[] = [];
  const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    if (from === undefined || to === undefined) continue;
    const steps = Math.max(1, Math.ceil(distance(from, to) / maximumStepMm));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      measured.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
  }
  const last = points.at(-1);
  if (!closed && last !== undefined) measured.push(last);
  return measured;
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
