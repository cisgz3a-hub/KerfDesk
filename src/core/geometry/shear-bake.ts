// Shear / skew (LightBurn transform controls), baked into vector geometry.
// The object transform has no skew term, so a shear about a world point c is
// written into the object's local curves instead: with T the object
// transform and W(p) = S (p - c) + c the world shear, each local point maps
// through M = T^-1 · W · T and the transform stays as it was, so the placed
// artwork is exactly W applied to what was there. Lines, cubics and
// elliptical arcs all map exactly under an affine map.

import type { CurveSubpath, PathSegment, Transform, Vec2 } from '../scene';
import { transformCurveSubpathExact, type AffineMatrix } from '../vector-export/affine-curves';

/** Largest shear angle accepted, short of the degenerate 90 degrees. */
export const MAX_SHEAR_DEG = 85;

export function transformAffine(t: Transform): AffineMatrix {
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = t.scaleX * (t.mirrorX ? -1 : 1);
  const sy = t.scaleY * (t.mirrorY ? -1 : 1);
  return { a: sx * cos, b: sx * sin, c: -sy * sin, d: sy * cos, e: t.x, f: t.y };
}

export function multiplyAffine(m: AffineMatrix, n: AffineMatrix): AffineMatrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invertAffine(m: AffineMatrix): AffineMatrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** The world shear about `center`: x += tan(ax)·(y - cy), y += tan(ay)·(x - cx). */
export function worldShear(center: Vec2, angleXDeg: number, angleYDeg: number): AffineMatrix {
  const kx = Math.tan((angleXDeg * Math.PI) / 180);
  const ky = Math.tan((angleYDeg * Math.PI) / 180);
  return { a: 1, b: ky, c: kx, d: 1, e: -kx * center.y, f: -ky * center.x };
}

/** The local-space map that bakes `world` into geometry placed by `transform`. */
export function localBakeMatrix(transform: Transform, world: AffineMatrix): AffineMatrix | null {
  const placed = transformAffine(transform);
  const inverse = invertAffine(placed);
  return inverse === null ? null : multiplyAffine(inverse, multiplyAffine(world, placed));
}

export function bakeCurves(
  curves: ReadonlyArray<CurveSubpath>,
  matrix: AffineMatrix,
): ReadonlyArray<CurveSubpath> {
  return curves.map((curve) => {
    const mapped = transformCurveSubpathExact(curve, matrix);
    return { ...mapped, segments: mapped.segments.map(plainSegment) };
  });
}

// The exact arc map tags its result with a non-serialisable export marker;
// scene geometry keeps only the plain segment.
function plainSegment(segment: PathSegment): PathSegment {
  if (segment.kind !== 'elliptical-arc') return segment;
  const { kind, radiusX, radiusY, rotationDeg, largeArc, sweep, to } = segment;
  return { kind, radiusX, radiusY, rotationDeg, largeArc, sweep, to };
}
