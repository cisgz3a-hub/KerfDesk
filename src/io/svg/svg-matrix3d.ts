// 4x4 matrices for CSS transforms, stored column-major in CSS matrix3d()
// order. A browser draws an SVG element with the 2D affine part of its full
// CSS transform (Chromium's TransformationMatrix::ToAffineTransform): z and
// perspective terms leave that part unchanged, so 3D functions flatten
// orthographically (ground truth: Chromium 156, ADR-574 Amendment 1).

import type { SvgMatrix } from './svg-curve-transform';

export type Matrix3d = ReadonlyArray<number>;

export const IDENTITY_MATRIX3D: Matrix3d = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** left · right: right applies to a point first. */
export function multiplyMatrix3d(left: Matrix3d, right: Matrix3d): Matrix3d {
  const out: number[] = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (left[k * 4 + row] ?? 0) * (right[column * 4 + k] ?? 0);
      out.push(sum);
    }
  }
  return out;
}

export function matrix3dFrom2d(a: number, b: number, c: number, d: number, e = 0, f = 0): Matrix3d {
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
}

export function translateMatrix3d(x: number, y: number, z = 0): Matrix3d {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function scaleMatrix3d(x: number, y: number, z = 1): Matrix3d {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

export function skewMatrix3d(xDeg: number, yDeg: number): Matrix3d {
  return matrix3dFrom2d(1, Math.tan(radians(yDeg)), Math.tan(radians(xDeg)), 1);
}

/** rotate3d(x, y, z, angle) as CSS Transforms 2 §12 defines it; a zero axis is no rotation. */
export function rotateMatrix3d(x: number, y: number, z: number, deg: number): Matrix3d {
  const length = Math.hypot(x, y, z);
  if (length === 0 || !Number.isFinite(length)) return IDENTITY_MATRIX3D;
  if (x === 0 && y === 0) {
    const turn = Math.sign(z) * radians(deg);
    return matrix3dFrom2d(Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn));
  }
  const [ux, uy, uz] = [x / length, y / length, z / length];
  const half = radians(deg) / 2;
  const sc = Math.sin(half) * Math.cos(half);
  const sq = Math.sin(half) ** 2;
  return [
    1 - 2 * (uy * uy + uz * uz) * sq,
    2 * (ux * uy * sq + uz * sc),
    2 * (ux * uz * sq - uy * sc),
    0,
    2 * (ux * uy * sq - uz * sc),
    1 - 2 * (ux * ux + uz * uz) * sq,
    2 * (uy * uz * sq + ux * sc),
    0,
    2 * (ux * uz * sq + uy * sc),
    2 * (uy * uz * sq - ux * sc),
    1 - 2 * (ux * ux + uy * uy) * sq,
    0,
    0,
    0,
    0,
    1,
  ];
}

/** The 2D affine part a browser draws an SVG element with. */
export function affineOfMatrix3d(matrix: Matrix3d): SvgMatrix {
  const at = (index: number) => matrix[index] ?? 0;
  return { a: at(0), b: at(1), c: at(4), d: at(5), e: at(12), f: at(13) };
}

function radians(deg: number): number {
  return (deg / 180) * Math.PI;
}
