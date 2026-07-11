// fair-chain — Whittaker–Henderson penalized smoothing of dense boundary
// chains (research brief #3). The no-splitting alternative to error-driven
// fitting on rough ink: minimize Σ(yᵢ−xᵢ)² + λΣ(Δ²xᵢ)² per coordinate,
// solved as one pentadiagonal banded system per corner-delimited segment.
// The frequency response H(ω) = 1/(1 + λ(2sin(ω/2))⁴) makes the behavior a
// CONTRACT: with the cutoff at twice the ink-texture wavelength, texture
// attenuates ~94% while drawn waves at 4x the cutoff keep ~95%.
//
// Corners are hard boundaries: the chain splits there into independent open
// segments with clamped endpoints (huge fidelity weight + exact snap), so a
// corner never smears. Closed cornerless rings are smoothed with wrap
// padding — the pads absorb boundary effects and are discarded.
//
// Standard published numerics (Whittaker 1923; Eilers 2003); banded
// Cholesky is textbook. Pure core — deterministic, no I/O.

import type { Vec2 } from '../scene';

// Ink/brush texture wavelength observed on hand-drawn sources, SOURCE px.
const TEXTURE_WAVELENGTH_PX = 6;
// Cutoff at twice the texture wavelength (research recipe).
const CUTOFF_FACTOR = 2;
// Soft clamp weight for segment endpoints (effectively exact in float64).
const CLAMP_WEIGHT = 1e9;
// Segments shorter than this are left untouched (nothing to smooth).
const MIN_SEGMENT_POINTS = 7;
// Wrap padding for cornerless closed rings, in cutoff wavelengths.
const WRAP_PAD_CUTOFFS = 4;

/** Smooth a dense chain between pinned corners. Corner objects are
 *  preserved by reference (downstream corner-aware stages look points up by
 *  identity); every other vertex is replaced by its smoothed position. */
export function fairChainSegments(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  pixelScale: number,
): Vec2[] {
  const n = points.length;
  if (n < MIN_SEGMENT_POINTS) return [...points];
  const spacing = averageSpacing(points, closed);
  if (spacing <= 0) return [...points];
  const scale = Number.isFinite(pixelScale) && pixelScale >= 1 ? pixelScale : 1;
  const cutoffSamples = (CUTOFF_FACTOR * TEXTURE_WAVELENGTH_PX * scale) / spacing;
  const lambda = (cutoffSamples / (2 * Math.PI)) ** 4;

  const cornerIndices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (corners.has(points[i] as Vec2)) cornerIndices.push(i);
  }
  if (closed && cornerIndices.length === 0) {
    return smoothClosedRing(points, lambda, cutoffSamples);
  }
  return smoothBetweenCorners(points, closed, cornerIndices, lambda);
}

function averageSpacing(points: ReadonlyArray<Vec2>, closed: boolean): number {
  let length = 0;
  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i += 1) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length / Math.max(1, edges);
}

function smoothBetweenCorners(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  cornerIndices: ReadonlyArray<number>,
  lambda: number,
): Vec2[] {
  // Rotate closed chains so segments never straddle the seam.
  const first = cornerIndices[0] ?? 0;
  const ring = closed ? [...points.slice(first), ...points.slice(0, first)] : [...points];
  const bounds: number[] = closed
    ? [
        0,
        ...cornerIndices.slice(1).map((i) => (i - first + points.length) % points.length),
        ring.length,
      ]
    : [0, ...cornerIndices.filter((i) => i > 0 && i < points.length - 1), ring.length - 1];
  const out = [...ring];
  for (let b = 0; b + 1 < bounds.length; b += 1) {
    const from = bounds[b] as number;
    const to = Math.min(bounds[b + 1] as number, ring.length - 1);
    smoothOpenSegmentInto(out, ring, from, to, lambda);
  }
  if (!closed) return out;
  // Rotate back so callers see the original ordering.
  const back = points.length - first;
  return [...out.slice(back), ...out.slice(0, back)];
}

// Smooth ring[from..to] (inclusive) with clamped endpoints, writing interior
// results into out. Endpoint objects are preserved by reference.
function smoothOpenSegmentInto(
  out: Vec2[],
  ring: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  lambda: number,
): void {
  const count = to - from + 1;
  if (count < MIN_SEGMENT_POINTS) return;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const p = ring[from + i] as Vec2;
    xs[i] = p.x;
    ys[i] = p.y;
  }
  const sx = whittakerSmooth(xs, lambda);
  const sy = whittakerSmooth(ys, lambda);
  for (let i = 1; i < count - 1; i += 1) {
    out[from + i] = { x: sx[i] as number, y: sy[i] as number };
  }
  // Endpoints stay the ORIGINAL objects (corner identity + exact position).
  out[from] = ring[from] as Vec2;
  out[to] = ring[to] as Vec2;
}

function smoothClosedRing(
  points: ReadonlyArray<Vec2>,
  lambda: number,
  cutoffSamples: number,
): Vec2[] {
  const n = points.length;
  const pad = Math.min(n, Math.ceil(WRAP_PAD_CUTOFFS * cutoffSamples));
  const total = n + 2 * pad;
  const xs = new Float64Array(total);
  const ys = new Float64Array(total);
  for (let i = 0; i < total; i += 1) {
    const p = points[(((i - pad) % n) + n) % n] as Vec2;
    xs[i] = p.x;
    ys[i] = p.y;
  }
  const sx = whittakerSmooth(xs, lambda);
  const sy = whittakerSmooth(ys, lambda);
  const out: Vec2[] = new Array<Vec2>(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = { x: sx[pad + i] as number, y: sy[pad + i] as number };
  }
  return out;
}

// ——— Whittaker–Henderson solve ———
// A = W + λ·D₂ᵀD₂ is symmetric positive definite and pentadiagonal; solved
// by banded LDLᵀ (Cholesky) in O(n). Endpoints carry CLAMP_WEIGHT so the
// segment ends stay put (then snapped exactly by the caller).

function whittakerSmooth(y: Float64Array, lambda: number): Float64Array {
  const n = y.length;
  // Pentadiagonal bands of λ·D₂ᵀD₂ (natural boundary conditions).
  const d0 = new Float64Array(n); // main diagonal
  const d1 = new Float64Array(n); // first super-diagonal (i, i+1)
  const d2 = new Float64Array(n); // second super-diagonal (i, i+2)
  for (let i = 0; i < n - 2; i += 1) {
    // Row (1,-2,1) of D₂ starting at i contributes to A[i..i+2].
    d0[i] = (d0[i] as number) + lambda;
    d0[i + 1] = (d0[i + 1] as number) + 4 * lambda;
    d0[i + 2] = (d0[i + 2] as number) + lambda;
    d1[i] = (d1[i] as number) - 2 * lambda;
    d1[i + 1] = (d1[i + 1] as number) - 2 * lambda;
    d2[i] = (d2[i] as number) + lambda;
  }
  for (let i = 0; i < n; i += 1) {
    const w = i === 0 || i === n - 1 ? CLAMP_WEIGHT : 1;
    d0[i] = (d0[i] as number) + w;
  }
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const w = i === 0 || i === n - 1 ? CLAMP_WEIGHT : 1;
    rhs[i] = w * (y[i] as number);
  }
  return solvePentadiagonal(d0, d1, d2, rhs);
}

type PentaFactor = {
  readonly diag: Float64Array; // D
  readonly e1: Float64Array; // L[i+1][i]
  readonly e2: Float64Array; // L[i+2][i]
};

// Banded LDLᵀ factorization + solve for an SPD pentadiagonal system. Bands
// are (d0 main, d1 first super, d2 second super); symmetric.
function solvePentadiagonal(
  d0: Float64Array,
  d1: Float64Array,
  d2: Float64Array,
  rhs: Float64Array,
): Float64Array {
  const factor = factorizePentadiagonal(d0, d1, d2);
  return substitutePentadiagonal(factor, rhs);
}

function factorizePentadiagonal(d0: Float64Array, d1: Float64Array, d2: Float64Array): PentaFactor {
  const n = d0.length;
  const diag = new Float64Array(n);
  const e1 = new Float64Array(n);
  const e2 = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let di = d0[i] as number;
    if (i >= 1) di -= (e1[i - 1] as number) ** 2 * (diag[i - 1] as number);
    if (i >= 2) di -= (e2[i - 2] as number) ** 2 * (diag[i - 2] as number);
    diag[i] = di;
    if (i + 1 < n) {
      const cross =
        i >= 1 ? (e1[i - 1] as number) * (e2[i - 1] as number) * (diag[i - 1] as number) : 0;
      e1[i] = ((d1[i] as number) - cross) / di;
    }
    if (i + 2 < n) e2[i] = (d2[i] as number) / di;
  }
  return { diag, e1, e2 };
}

function substitutePentadiagonal(factor: PentaFactor, rhs: Float64Array): Float64Array {
  const { diag, e1, e2 } = factor;
  const n = rhs.length;
  // Forward substitution L z = rhs.
  const z = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let v = rhs[i] as number;
    if (i >= 1) v -= (e1[i - 1] as number) * (z[i - 1] as number);
    if (i >= 2) v -= (e2[i - 2] as number) * (z[i - 2] as number);
    z[i] = v;
  }
  // Diagonal + back substitution Lᵀ x = D⁻¹ z.
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let v = (z[i] as number) / (diag[i] as number);
    if (i + 1 < n) v -= (e1[i] as number) * (x[i + 1] as number);
    if (i + 2 < n) v -= (e2[i] as number) * (x[i + 2] as number);
    x[i] = v;
  }
  return x;
}
