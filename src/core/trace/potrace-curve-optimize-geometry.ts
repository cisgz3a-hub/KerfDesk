import type { PotraceCurve, PotraceCurveSegment } from './potrace-curve';

export type PointLike = {
  x: number;
  y: number;
};

export function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

export function pointAt(points: readonly PointLike[], index: number): PointLike {
  const point = points[index];
  if (point === undefined) throw new Error(`Missing Potrace point at ${index}`);
  return point;
}

export function segmentAt(curve: PotraceCurve, index: number): PotraceCurveSegment {
  const segment = curve.segments[index];
  if (segment === undefined) throw new Error(`Missing Potrace curve segment at ${index}`);
  return segment;
}

export function copyPoint(point: PointLike): PointLike {
  return { x: point.x, y: point.y };
}

export function interval(lambda: number, a: PointLike, b: PointLike): PointLike {
  return {
    x: a.x + lambda * (b.x - a.x),
    y: a.y + lambda * (b.y - a.y),
  };
}

export function dpara(a: PointLike, b: PointLike, c: PointLike): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function cprod(p0: PointLike, p1: PointLike, p2: PointLike, p3: PointLike): number {
  return (p1.x - p0.x) * (p3.y - p2.y) - (p1.y - p0.y) * (p3.x - p2.x);
}

export function iprod(p0: PointLike, p1: PointLike, p2: PointLike): number {
  return (p1.x - p0.x) * (p2.x - p0.x) + (p1.y - p0.y) * (p2.y - p0.y);
}

export function iprod1(p0: PointLike, p1: PointLike, p2: PointLike, p3: PointLike): number {
  return (p1.x - p0.x) * (p3.x - p2.x) + (p1.y - p0.y) * (p3.y - p2.y);
}

export function ddist(a: PointLike, b: PointLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function bezier(
  t: number,
  p0: PointLike,
  p1: PointLike,
  p2: PointLike,
  p3: PointLike,
): PointLike {
  const s = 1 - t;
  return {
    x: s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * t * t * s * p2.x + t * t * t * p3.x,
    y: s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * t * t * s * p2.y + t * t * t * p3.y,
  };
}

export function tangent(
  p0: PointLike,
  p1: PointLike,
  p2: PointLike,
  p3: PointLike,
  q0: PointLike,
  q1: PointLike,
): number {
  const a0 = cprod(p0, p1, q0, q1);
  const b0 = cprod(p1, p2, q0, q1);
  const c0 = cprod(p2, p3, q0, q1);
  const a = a0 - 2 * b0 + c0;
  const b = -2 * a0 + 2 * b0;
  const c = a0;
  const determinant = b * b - 4 * a * c;
  if (a === 0 || determinant < 0) return -1;

  const root = Math.sqrt(determinant);
  const r1 = (-b + root) / (2 * a);
  const r2 = (-b - root) / (2 * a);
  if (r1 >= 0 && r1 <= 1) return r1;
  if (r2 >= 0 && r2 <= 1) return r2;
  return -1;
}

export function cloneCurve(curve: PotraceCurve): PotraceCurve {
  return {
    alphaCurve: curve.alphaCurve,
    segments: curve.segments.map((segment) => ({
      tag: segment.tag,
      vertex: copyPoint(segment.vertex),
      c: [copyPoint(segment.c[0]), copyPoint(segment.c[1]), copyPoint(segment.c[2])],
      alpha: segment.alpha,
      alpha0: segment.alpha0,
      beta: segment.beta,
    })),
  };
}
