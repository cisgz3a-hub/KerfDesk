// Brings pieces fitted in world millimetres back into an object's own
// coordinates (Optimize Shapes, LBG-T22), so its placement stays as it was.
// The placement is affine: lines and cubics map by their points. A circular
// arc maps to an elliptical arc whose axes are the singular vectors of the
// inverse map scaled by the radius (a plain circle again for uniform scale),
// and it runs the other way when the placement mirrors.

import type { PathSegment, Transform, Vec2 } from '../../scene/scene-object';
import type { WorldPiece } from './run-fitting';

export type InversePlacement = {
  readonly toLocal: (point: Vec2) => Vec2;
  /** Inverse linear part [a b; c d]: local = [a b; c d] (world - translation). */
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
};

/** The inverse of applyTransform (scale, mirror, rotate, translate). */
export function inversePlacement(transform: Transform): InversePlacement {
  const sx = (transform.mirrorX ? -1 : 1) * transform.scaleX;
  const sy = (transform.mirrorY ? -1 : 1) * transform.scaleY;
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = cos / sx;
  const b = sin / sx;
  const c = -sin / sy;
  const d = cos / sy;
  return {
    a,
    b,
    c,
    d,
    toLocal: (point) => {
      const x = point.x - transform.x;
      const y = point.y - transform.y;
      return { x: a * x + b * y, y: c * x + d * y };
    },
  };
}

export function localSegment(piece: WorldPiece, inverse: InversePlacement): PathSegment {
  const { toLocal } = inverse;
  if (piece.kind === 'line') return { kind: 'line', to: toLocal(piece.end) };
  if (piece.kind === 'cubic') {
    return {
      kind: 'cubic',
      control1: toLocal(piece.control1),
      control2: toLocal(piece.control2),
      to: toLocal(piece.end),
    };
  }
  const { arc } = piece;
  const axes = singularValues(inverse);
  const mirrored = inverse.a * inverse.d - inverse.b * inverse.c < 0;
  return {
    kind: 'elliptical-arc',
    radiusX: arc.radius * axes.major,
    radiusY: arc.radius * axes.minor,
    rotationDeg: axes.major === axes.minor ? 0 : (axes.rotationRad * 180) / Math.PI,
    largeArc: arc.sweep > Math.PI,
    // SVG's sweep flag follows increasing angle, which is counter-clockwise.
    sweep: arc.clockwise === mirrored,
    to: toLocal(arc.end),
  };
}

// Closed-form SVD of a 2x2 matrix: the image of the unit circle is an ellipse
// with semi-axes `major` and `minor`, the major one at `rotationRad`.
function singularValues(m: InversePlacement): {
  readonly major: number;
  readonly minor: number;
  readonly rotationRad: number;
} {
  const e = (m.a + m.d) / 2;
  const f = (m.a - m.d) / 2;
  const g = (m.c + m.b) / 2;
  const h = (m.c - m.b) / 2;
  const q = Math.hypot(e, h);
  const r = Math.hypot(f, g);
  const major = q + r;
  const minor = Math.abs(q - r);
  if (Math.abs(major - minor) <= 1e-12 * major) return { major, minor: major, rotationRad: 0 };
  return { major, minor, rotationRad: (Math.atan2(g, f) + Math.atan2(h, e)) / 2 };
}
