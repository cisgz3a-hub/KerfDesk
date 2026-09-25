import type { Transform } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';

/** Scene transforms cannot represent shear. Never replace it with an AABB. */
export function svgMatrixToSceneTransform(m: SvgMatrix): Transform {
  if (!Object.values(m).every(Number.isFinite)) throw new Error('SVG transform is not finite.');
  const scaleX = Math.hypot(m.a, m.b);
  const scaleY = Math.hypot(m.c, m.d);
  if (scaleX === 0 || scaleY === 0) throw new Error('SVG image transform collapses an axis.');
  const dot = (m.a / scaleX) * (m.c / scaleY) + (m.b / scaleX) * (m.d / scaleY);
  if (Math.abs(dot) > 1e-10)
    throw new Error('Skewed SVG images are not supported. Remove the skew first.');
  return {
    x: m.e,
    y: m.f,
    scaleX,
    scaleY,
    rotationDeg: (Math.atan2(m.b, m.a) * 180) / Math.PI,
    mirrorX: false,
    mirrorY: (m.a / scaleX) * (m.d / scaleY) - (m.b / scaleX) * (m.c / scaleY) < 0,
  };
}

export function inverseSvgMatrix(m: SvgMatrix): SvgMatrix {
  const determinant = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new Error('SVG transform cannot be inverted.');
  return {
    a: m.d / determinant,
    b: -m.b / determinant,
    c: -m.c / determinant,
    d: m.a / determinant,
    e: (m.c * m.f - m.d * m.e) / determinant,
    f: (m.b * m.e - m.a * m.f) / determinant,
  };
}
