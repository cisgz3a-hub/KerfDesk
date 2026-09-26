// Initial camera pose of a planar target (ADR-440): a least-squares plane
// homography from target millimetres to normalised camera rays, decomposed
// into rotation and translation (Zhang 2000, §3.1). Only the starting point
// for the nonlinear fit, so a Hartley-normalised DLT through the normal
// equations is accurate enough and needs no SVD. Pure core.

import type { Mat3 } from '../homography';
import { rotationToRvec } from '../rodrigues';
import { choleskySolve } from './cholesky';
import type { CameraPose, Vec2 } from './camera-model';

export type PlaneCorrespondence = {
  /** Target point on the plane z = planeZ, world millimetres. */
  readonly plane: Vec2;
  /** Normalised camera ray (X/Z, Y/Z) that observes it. */
  readonly ray: Vec2;
};

type Normaliser = { readonly cx: number; readonly cy: number; readonly scale: number };

/** Least-squares homography mapping plane points to rays (≥ 4 non-collinear points). */
export function fitPlaneHomography(pairs: ReadonlyArray<PlaneCorrespondence>): Mat3 | null {
  if (pairs.length < 4) return null;
  const src = normaliser(pairs.map((p) => p.plane));
  const dst = normaliser(pairs.map((p) => p.ray));
  const ata = new Float64Array(64);
  const atb = new Float64Array(8);
  for (const pair of pairs) {
    const x = (pair.plane.x - src.cx) * src.scale;
    const y = (pair.plane.y - src.cy) * src.scale;
    const u = (pair.ray.x - dst.cx) * dst.scale;
    const v = (pair.ray.y - dst.cy) * dst.scale;
    accumulate(ata, atb, [x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    accumulate(ata, atb, [0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = choleskySolve(ata, atb, 8);
  if (h === null) return null;
  const normalised: Mat3 = [
    h[0] ?? 0,
    h[1] ?? 0,
    h[2] ?? 0,
    h[3] ?? 0,
    h[4] ?? 0,
    h[5] ?? 0,
    h[6] ?? 0,
    h[7] ?? 0,
    1,
  ];
  return denormalise(normalised, src, dst);
}

/**
 * Decompose a plane→ray homography into the pose that sees the plane
 * z = `planeZ`, with the target in front of the camera. Null when degenerate.
 */
export function poseFromPlaneHomography(h: Mat3, planeZ: number): CameraPose | null {
  const n1 = Math.hypot(h[0], h[3], h[6]);
  const n2 = Math.hypot(h[1], h[4], h[7]);
  if (!(n1 > 0) || !(n2 > 0)) return null;
  let lambda = 2 / (n1 + n2);
  if (h[8] * lambda < 0) lambda = -lambda; // plane origin must be in front (z > 0)
  const r1 = [h[0] * lambda, h[3] * lambda, h[6] * lambda] as const;
  const r2 = [h[1] * lambda, h[4] * lambda, h[7] * lambda] as const;
  const r3 = cross(r1, r2);
  const rotation = orthonormalise([r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]]);
  const t = [h[2] * lambda, h[5] * lambda, h[8] * lambda] as const;
  // Column 3 of H is planeZ·r3 + t for a plane at constant z.
  const tvec = [
    t[0] - planeZ * rotation[2],
    t[1] - planeZ * rotation[5],
    t[2] - planeZ * rotation[8],
  ] as const;
  return { rvec: rotationToRvec(rotation), tvec };
}

function accumulate(ata: Float64Array, atb: Float64Array, row: ReadonlyArray<number>, rhs: number) {
  for (let i = 0; i < 8; i += 1) {
    const ri = row[i] ?? 0;
    atb[i] = (atb[i] ?? 0) + ri * rhs;
    for (let j = 0; j < 8; j += 1) ata[i * 8 + j] = (ata[i * 8 + j] ?? 0) + ri * (row[j] ?? 0);
  }
}

function normaliser(points: ReadonlyArray<Vec2>): Normaliser {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let spread = 0;
  for (const p of points) spread += Math.hypot(p.x - cx, p.y - cy);
  spread /= points.length;
  return { cx, cy, scale: spread > 0 ? Math.SQRT2 / spread : 1 };
}

// H = T_dst⁻¹ · Ĥ · T_src, where T maps a point to its normalised form.
function denormalise(h: Mat3, src: Normaliser, dst: Normaliser): Mat3 {
  const tSrc: Mat3 = [
    src.scale,
    0,
    -src.scale * src.cx,
    0,
    src.scale,
    -src.scale * src.cy,
    0,
    0,
    1,
  ];
  const tDstInv: Mat3 = [1 / dst.scale, 0, dst.cx, 0, 1 / dst.scale, dst.cy, 0, 0, 1];
  const m = multiply(tDstInv, multiply(h, tSrc));
  const w = m[8] === 0 ? 1 : m[8];
  return m.map((v) => v / w) as unknown as Mat3;
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const row = r * 3;
      out.push(
        (a[row] ?? 0) * (b[c] ?? 0) +
          (a[row + 1] ?? 0) * (b[3 + c] ?? 0) +
          (a[row + 2] ?? 0) * (b[6 + c] ?? 0),
      );
    }
  }
  return out as unknown as Mat3;
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// Nearest rotation by Higham's polar iteration R ← (R + R⁻ᵀ)/2.
function orthonormalise(m: Mat3): Mat3 {
  let r = m;
  for (let i = 0; i < 20; i += 1) {
    const inverseTranspose = invertTranspose(r);
    if (inverseTranspose === null) return r;
    r = r.map((v, k) => (v + (inverseTranspose[k] ?? 0)) / 2) as unknown as Mat3;
  }
  return r;
}

function invertTranspose(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const co = [e * i - f * h, f * g - d * i, d * h - e * g];
  const det = a * (co[0] ?? 0) + b * (co[1] ?? 0) + c * (co[2] ?? 0);
  if (Math.abs(det) < 1e-15) return null;
  // (M⁻¹)ᵀ = cofactor(M) / det.
  return [
    e * i - f * h,
    f * g - d * i,
    d * h - e * g,
    c * h - b * i,
    a * i - c * g,
    b * g - a * h,
    b * f - c * e,
    c * d - a * f,
    a * e - b * d,
  ].map((v) => v / det) as unknown as Mat3;
}
