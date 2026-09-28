// snap-affine — an object's Transform as a 2x3 matrix, and its inverse.
//
// Snap candidates are indexed once in each path's LOCAL coordinates, so moving,
// rotating or scaling an object never rebuilds its index. A query then maps the
// pointer into local space, looks up nearby candidates there, and maps only
// those back out. The matrix is the same scale → mirror → rotate → translate
// order applyTransform uses, with the trig done once per object instead of once
// per point.

import type { Transform, Vec2 } from '../../../core/scene';

// world = (a*x + c*y + e, b*x + d*y + f)
export type Affine = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function affineFromTransform(t: Transform): Affine {
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = t.scaleX * (t.mirrorX ? -1 : 1);
  const sy = t.scaleY * (t.mirrorY ? -1 : 1);
  return { a: sx * cos, b: sx * sin, c: -sy * sin, d: sy * cos, e: t.x, f: t.y };
}

export function applyAffine(m: Affine, x: number, y: number): Vec2 {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

// Null for a collapsed transform (zero scale): nothing on it can be snapped to.
export function invertAffine(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

// The local-space box covering a world-space box: its four corners mapped
// through the inverse. A superset of the world query, never an undercount.
export function mapBox(m: Affine, box: Box): Box {
  const corners = [
    applyAffine(m, box.minX, box.minY),
    applyAffine(m, box.maxX, box.minY),
    applyAffine(m, box.maxX, box.maxY),
    applyAffine(m, box.minX, box.maxY),
  ];
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxX: Math.max(...corners.map((p) => p.x)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
}

export function boxAround(point: Vec2, radius: number): Box {
  return {
    minX: point.x - radius,
    minY: point.y - radius,
    maxX: point.x + radius,
    maxY: point.y + radius,
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}
