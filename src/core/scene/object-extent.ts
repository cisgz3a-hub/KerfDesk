// The smallest world-axis box that holds an object's own geometry (ADR-677).
//
// The corners of an object's local bounds, transformed, give that box only
// while the object is square to the bed: turned at another angle, a circle's
// bounds square turns with it and its corners stick out past the circle (a
// 50 mm circle at 45° read 70.711 wide). LightBurn measures a selection as
// "the smallest possible rectangle that can contain every object", so this
// measures the outline itself: polyline points, the extremes of each cubic and
// of each elliptical arc, all in world axes. It reads the same geometry the
// compiler flattens (canonical curves when present, else the polylines).

import { endpointArc } from './curve-path';
import type {
  Bounds,
  ColoredPath,
  CubicPathSegment,
  EllipticalArcPathSegment,
  SceneObject,
  Transform,
  Vec2,
} from './scene-object';

const ROTATION_EPSILON_DEG = 0.000001;
const QUARTER_TURN_DEG = 90;
const FULL_TURN_DEG = 360;
const TAU = Math.PI * 2;
const SWEEP_EPSILON = 1e-12;
const DERIVATIVE_EPSILON = 1e-12;

/** The world-axis box of the object's outline under its transform, or null
 *  when the transformed corners of its local bounds are already that box: an
 *  object square to the bed, an image or relief (whose footprint is its
 *  rectangle), a barcode (whose box includes its quiet zone) or no outline. */
export function objectGeometryExtent(object: SceneObject): Bounds | null {
  if (isSquareToBed(object.transform.rotationDeg)) return null;
  if (object.kind === 'raster-image' || object.kind === 'relief') return null;
  if (object.kind === 'shape' && object.spec.kind === 'barcode') return null;
  const atOrigin = cachedExtentAtOrigin(object.paths, object.transform);
  if (atOrigin === null) return null;
  return {
    minX: atOrigin.minX + object.transform.x,
    minY: atOrigin.minY + object.transform.y,
    maxX: atOrigin.maxX + object.transform.x,
    maxY: atOrigin.maxY + object.transform.y,
  };
}

// A move changes only the translation, so the box is kept per outline and per
// scale, mirror and rotation: dragging a turned trace measures it once.
type CachedExtent = {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly mirrorX: boolean;
  readonly mirrorY: boolean;
  readonly rotationDeg: number;
  readonly extent: Bounds | null;
};

const extentCache = new WeakMap<ReadonlyArray<ColoredPath>, CachedExtent>();

function cachedExtentAtOrigin(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
): Bounds | null {
  const cached = extentCache.get(paths);
  if (cached !== undefined && sameLinearPart(cached, transform)) return cached.extent;
  const extent = extentAtOrigin(paths, linearPart(transform));
  extentCache.set(paths, {
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    mirrorX: transform.mirrorX,
    mirrorY: transform.mirrorY,
    rotationDeg: transform.rotationDeg,
    extent,
  });
  return extent;
}

function sameLinearPart(cached: CachedExtent, transform: Transform): boolean {
  return (
    cached.scaleX === transform.scaleX &&
    cached.scaleY === transform.scaleY &&
    cached.mirrorX === transform.mirrorX &&
    cached.mirrorY === transform.mirrorY &&
    cached.rotationDeg === transform.rotationDeg
  );
}

/** applyTransform without the translation: x' = a·x + c·y, y' = b·x + d·y. */
type Linear = { readonly a: number; readonly b: number; readonly c: number; readonly d: number };

function linearPart(transform: Transform): Linear {
  const sx = transform.scaleX * (transform.mirrorX ? -1 : 1);
  const sy = transform.scaleY * (transform.mirrorY ? -1 : 1);
  const { cos, sin } = turnCosSin(transform.rotationDeg);
  return { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy };
}

// The angle's remainder past whole quarter turns goes through the trig; the
// quarter turns are applied exactly, so turning an object a quarter turn
// (Rotate 90°, ADR-410) turns its extent with no new trigonometric rounding.
function turnCosSin(rotationDeg: number): { readonly cos: number; readonly sin: number } {
  const quarters = Math.floor(rotationDeg / QUARTER_TURN_DEG);
  const rad = ((rotationDeg - quarters * QUARTER_TURN_DEG) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  switch (((quarters % 4) + 4) % 4) {
    case 1:
      return { cos: -sin, sin: cos };
    case 2:
      return { cos: -cos, sin: -sin };
    case 3:
      return { cos: sin, sin: -cos };
    default:
      return { cos, sin };
  }
}

type MutableBounds = { minX: number; minY: number; maxX: number; maxY: number };

function extentAtOrigin(paths: ReadonlyArray<ColoredPath>, m: Linear): Bounds | null {
  const box: MutableBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const path of paths) extendWithPath(box, path, m);
  const finite = [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite);
  return finite ? box : null;
}

function extendWithPath(box: MutableBounds, path: ColoredPath, m: Linear): void {
  if (path.curves === undefined) {
    for (const polyline of path.polylines) {
      for (const point of polyline.points) extendWithPoint(box, point, m);
    }
    return;
  }
  for (const curve of path.curves) {
    let from = curve.start;
    extendWithPoint(box, from, m);
    for (const segment of curve.segments) {
      if (segment.kind === 'cubic') extendWithCubic(box, from, segment, m);
      else if (segment.kind === 'elliptical-arc') extendWithArc(box, from, segment, m);
      extendWithPoint(box, segment.to, m);
      from = segment.to;
    }
  }
}

function extendWithPoint(box: MutableBounds, point: Vec2, m: Linear): void {
  extendX(box, m.a * point.x + m.c * point.y);
  extendY(box, m.b * point.x + m.d * point.y);
}

function extendX(box: MutableBounds, x: number): void {
  if (x < box.minX) box.minX = x;
  if (x > box.maxX) box.maxX = x;
}

function extendY(box: MutableBounds, y: number): void {
  if (y < box.minY) box.minY = y;
  if (y > box.maxY) box.maxY = y;
}

// An affine map takes a cubic to the cubic of its mapped control points, so
// each world axis is a one-dimensional Bernstein cubic: its extremes sit at
// the roots of its derivative inside (0, 1).
function extendWithCubic(
  box: MutableBounds,
  from: Vec2,
  segment: CubicPathSegment,
  m: Linear,
): void {
  const points = [from, segment.control1, segment.control2, segment.to];
  const xs = points.map((point) => m.a * point.x + m.c * point.y);
  const ys = points.map((point) => m.b * point.x + m.d * point.y);
  for (const t of derivativeRoots(xs)) extendX(box, bernstein(xs, t));
  for (const t of derivativeRoots(ys)) extendY(box, bernstein(ys, t));
}

function derivativeRoots(p: ReadonlyArray<number>): number[] {
  const [p0 = 0, p1 = 0, p2 = 0, p3 = 0] = p;
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  return quadraticRoots(a, b, c).filter((t) => t > 0 && t < 1);
}

function quadraticRoots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < DERIVATIVE_EPSILON) {
    return Math.abs(b) < DERIVATIVE_EPSILON ? [] : [-c / b];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

function bernstein(p: ReadonlyArray<number>, t: number): number {
  const [p0 = 0, p1 = 0, p2 = 0, p3 = 0] = p;
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// World point of the arc at θ: M·(centre + R(φ)·(rx·cosθ, ry·sinθ)). With
// K = M·R(φ), x(θ) = (M·centre).x + K00·rx·cosθ + K01·ry·sinθ, whose extremes
// sit at θ = atan2(K01·ry, K00·rx) and the opposite angle; likewise for y.
function extendWithArc(
  box: MutableBounds,
  from: Vec2,
  segment: EllipticalArcPathSegment,
  m: Linear,
): void {
  const arc = endpointArc(from, segment);
  if (arc === null) return;
  const cos = Math.cos(arc.rotationRad);
  const sin = Math.sin(arc.rotationRad);
  const k = { a: m.a * cos + m.c * sin, b: m.b * cos + m.d * sin };
  const l = { a: -m.a * sin + m.c * cos, b: -m.b * sin + m.d * cos };
  const centreX = m.a * arc.center.x + m.c * arc.center.y;
  const centreY = m.b * arc.center.x + m.d * arc.center.y;
  const xAt = (theta: number): number =>
    centreX + k.a * arc.radiusX * Math.cos(theta) + l.a * arc.radiusY * Math.sin(theta);
  const yAt = (theta: number): number =>
    centreY + k.b * arc.radiusX * Math.cos(theta) + l.b * arc.radiusY * Math.sin(theta);
  const xTheta = Math.atan2(l.a * arc.radiusY, k.a * arc.radiusX);
  const yTheta = Math.atan2(l.b * arc.radiusY, k.b * arc.radiusX);
  for (const theta of [xTheta, xTheta + Math.PI]) {
    if (angleInSweep(theta, arc.theta1, arc.delta)) extendX(box, xAt(theta));
  }
  for (const theta of [yTheta, yTheta + Math.PI]) {
    if (angleInSweep(theta, arc.theta1, arc.delta)) extendY(box, yAt(theta));
  }
}

function angleInSweep(angle: number, start: number, delta: number): boolean {
  const forward = (((angle - start) % TAU) + TAU) % TAU;
  return delta >= 0 ? forward <= delta + SWEEP_EPSILON : TAU - forward <= -delta + SWEEP_EPSILON;
}

function isSquareToBed(rotationDeg: number): boolean {
  if (!Number.isFinite(rotationDeg)) return true;
  const folded = ((rotationDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % QUARTER_TURN_DEG;
  return folded <= ROTATION_EPSILON_DEG || QUARTER_TURN_DEG - folded <= ROTATION_EPSILON_DEG;
}
