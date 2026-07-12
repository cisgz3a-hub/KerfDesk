import type {
  Bounds,
  CubicPathSegment,
  CurveSubpath,
  EllipticalArcPathSegment,
  PathSegment,
  Polyline,
  Vec2,
} from './scene-object';

export const DEFAULT_MACHINE_CURVE_TOLERANCE_MM = 0.025;
export const MAX_FLATTENED_CURVE_SEGMENTS = 200_000;

export type FlattenCurveOptions = {
  readonly toleranceMm: number;
  readonly segmentBudget?: number;
};

export type FlattenCurveResult =
  | { readonly kind: 'ok'; readonly polyline: Polyline; readonly segmentCount: number }
  | { readonly kind: 'segment-budget-exceeded'; readonly segmentBudget: number };

export function polylineToCurveSubpath(polyline: Polyline): CurveSubpath {
  const start = polyline.points[0] ?? { x: 0, y: 0 };
  return {
    start,
    segments: polyline.points.slice(1).map((to) => ({ kind: 'line' as const, to })),
    closed: polyline.closed,
  };
}

export function flattenCurveSubpath(
  path: CurveSubpath,
  options: FlattenCurveOptions,
): FlattenCurveResult {
  const tolerance = finitePositive(options.toleranceMm, DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
  const budget = Math.max(1, Math.floor(options.segmentBudget ?? MAX_FLATTENED_CURVE_SEGMENTS));
  const points: Vec2[] = [path.start];
  let current = path.start;
  for (const segment of path.segments) {
    const additions = flattenSegment(current, segment, tolerance);
    if (points.length - 1 + additions.length > budget) {
      return { kind: 'segment-budget-exceeded', segmentBudget: budget };
    }
    points.push(...additions);
    current = segment.to;
  }
  return { kind: 'ok', polyline: { points, closed: path.closed }, segmentCount: points.length - 1 };
}

export function curveSubpathBounds(path: CurveSubpath): Bounds {
  const points: Vec2[] = [path.start];
  let current = path.start;
  for (const segment of path.segments) {
    points.push(...segmentExtrema(current, segment));
    current = segment.to;
  }
  return boundsOf(points);
}

function flattenSegment(from: Vec2, segment: PathSegment, tolerance: number): Vec2[] {
  if (segment.kind === 'line') return [segment.to];
  if (segment.kind === 'cubic') return flattenCubic(from, segment, tolerance);
  return flattenArc(from, segment, tolerance);
}

function flattenCubic(from: Vec2, segment: CubicPathSegment, tolerance: number): Vec2[] {
  const out: Vec2[] = [];
  subdivideCubic(from, segment.control1, segment.control2, segment.to, tolerance, 0, out);
  return out;
}

function subdivideCubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  tolerance: number,
  depth: number,
  out: Vec2[],
): void {
  if (
    depth >= 24 ||
    Math.max(pointLineDistance(p1, p0, p3), pointLineDistance(p2, p0, p3)) <= tolerance
  ) {
    out.push(p3);
    return;
  }
  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);
  subdivideCubic(p0, p01, p012, p0123, tolerance, depth + 1, out);
  subdivideCubic(p0123, p123, p23, p3, tolerance, depth + 1, out);
}

function flattenArc(from: Vec2, segment: EllipticalArcPathSegment, tolerance: number): Vec2[] {
  const arc = endpointArc(from, segment);
  if (arc === null) return [segment.to];
  const maxRadius = Math.max(arc.radiusX, arc.radiusY);
  const ratio = Math.max(-1, Math.min(1, 1 - tolerance / maxRadius));
  const maxStep = Math.max(1e-6, 2 * Math.acos(ratio));
  const count = Math.max(1, Math.ceil(Math.abs(arc.delta) / maxStep));
  return Array.from({ length: count }, (_, index) =>
    pointOnArc(arc, arc.theta1 + (arc.delta * (index + 1)) / count),
  );
}

function segmentExtrema(from: Vec2, segment: PathSegment): Vec2[] {
  if (segment.kind === 'line') return [segment.to];
  if (segment.kind === 'cubic') return cubicExtrema(from, segment);
  const arc = endpointArc(from, segment);
  if (arc === null) return [segment.to];
  const phi = arc.rotationRad;
  const candidates = [
    Math.atan2(-arc.radiusY * Math.sin(phi), arc.radiusX * Math.cos(phi)),
    Math.atan2(-arc.radiusY * Math.sin(phi), arc.radiusX * Math.cos(phi)) + Math.PI,
    Math.atan2(arc.radiusY * Math.cos(phi), arc.radiusX * Math.sin(phi)),
    Math.atan2(arc.radiusY * Math.cos(phi), arc.radiusX * Math.sin(phi)) + Math.PI,
  ];
  return [
    segment.to,
    ...candidates
      .filter((angle) => angleInSweep(angle, arc.theta1, arc.delta))
      .map((angle) => pointOnArc(arc, angle)),
  ];
}

function cubicExtrema(from: Vec2, segment: CubicPathSegment): Vec2[] {
  const ts = new Set<number>();
  for (const axis of ['x', 'y'] as const) {
    for (const t of cubicDerivativeRoots(
      from[axis],
      segment.control1[axis],
      segment.control2[axis],
      segment.to[axis],
    )) {
      if (t > 0 && t < 1) ts.add(t);
    }
  }
  return [segment.to, ...[...ts].map((t) => cubicPoint(from, segment, t))];
}

function cubicDerivativeRoots(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

function cubicPoint(from: Vec2, segment: CubicPathSegment, t: number): Vec2 {
  const u = 1 - t;
  return {
    x:
      u ** 3 * from.x +
      3 * u * u * t * segment.control1.x +
      3 * u * t * t * segment.control2.x +
      t ** 3 * segment.to.x,
    y:
      u ** 3 * from.y +
      3 * u * u * t * segment.control1.y +
      3 * u * t * t * segment.control2.y +
      t ** 3 * segment.to.y,
  };
}

type CenterArc = {
  readonly center: Vec2;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationRad: number;
  readonly theta1: number;
  readonly delta: number;
};

function endpointArc(from: Vec2, segment: EllipticalArcPathSegment): CenterArc | null {
  if (samePoint(from, segment.to)) return null;
  let rx = Math.abs(segment.radiusX);
  let ry = Math.abs(segment.radiusY);
  if (rx <= 0 || ry <= 0) return null;
  const phi = (segment.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - segment.to.x) / 2;
  const dy = (from.y - segment.to.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const scale = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (scale > 1) {
    const factor = Math.sqrt(scale);
    rx *= factor;
    ry *= factor;
  }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const sign = segment.largeArc === segment.sweep ? -1 : 1;
  const coefficient = denominator <= 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const center = {
    x: cos * cxp - sin * cyp + (from.x + segment.to.x) / 2,
    y: sin * cxp + cos * cyp + (from.y + segment.to.y) / 2,
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = Math.atan2(uy, ux);
  let delta = signedAngle(ux, uy, vx, vy);
  if (!segment.sweep && delta > 0) delta -= Math.PI * 2;
  if (segment.sweep && delta < 0) delta += Math.PI * 2;
  return { center, radiusX: rx, radiusY: ry, rotationRad: phi, theta1, delta };
}

function pointOnArc(arc: CenterArc, theta: number): Vec2 {
  const cosPhi = Math.cos(arc.rotationRad);
  const sinPhi = Math.sin(arc.rotationRad);
  return {
    x:
      arc.center.x +
      arc.radiusX * Math.cos(theta) * cosPhi -
      arc.radiusY * Math.sin(theta) * sinPhi,
    y:
      arc.center.y +
      arc.radiusX * Math.cos(theta) * sinPhi +
      arc.radiusY * Math.sin(theta) * cosPhi,
  };
}

function angleInSweep(angle: number, start: number, delta: number): boolean {
  const tau = Math.PI * 2;
  const forward = (((angle - start) % tau) + tau) % tau;
  return delta >= 0 ? forward <= delta + 1e-12 : tau - forward <= -delta + 1e-12;
}

function signedAngle(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

function boundsOf(points: ReadonlyArray<Vec2>): Bounds {
  return points.reduce<Bounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function pointLineDistance(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length <= 1e-15
    ? Math.hypot(point.x - from.x, point.y - from.y)
    : Math.abs(dy * point.x - dx * point.y + to.x * from.y - to.y * from.x) / length;
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= 1e-12 && Math.abs(a.y - b.y) <= 1e-12;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
