import type { Mat3 } from './homography';

/**
 * 16 numbers in column-major order, the form a CSS `matrix3d(...)` transform
 * expects (the UI joins them into the string; core stays free of CSS).
 */
export type Matrix3d = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Embed a 2D homography (3×3) into the 4×4 CSS `matrix3d` that applies the
 * same projective warp to an element. The 3×3 `[a b c; d e f; g h i]` becomes
 *
 *   [ a b 0 c ]
 *   [ d e 0 f ]
 *   [ 0 0 1 0 ]
 *   [ g h 0 i ]
 *
 * — a Z identity row/column is inserted and the perspective terms `g, h` land
 * in the 4th row (NOT the 3rd; that transpose is the classic matrix3d bug).
 * The result is flattened column-major, which is the order `matrix3d()` reads.
 */
export function homographyToMatrix3d(h: Mat3): Matrix3d {
  return [
    h[0],
    h[3],
    0,
    h[6], // column 0
    h[1],
    h[4],
    0,
    h[7], // column 1
    0,
    0,
    1,
    0, // column 2
    h[2],
    h[5],
    0,
    h[8], // column 3
  ];
}
