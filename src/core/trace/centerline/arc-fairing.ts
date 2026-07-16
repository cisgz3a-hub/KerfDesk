// Arc-length quadratic fairing for the dense stroke chain — the anti-wobble
// stage (maintainer report 2026-07-16: "wobbly lines, not 100% smooth on
// turns").
//
// The 1-ring Taubin passes are a NARROW-band filter: they annihilate the
// adjacent-vertex staircase but mathematically pass ripple with wavelengths
// beyond ~6 vertices (their transfer function is ~1 there). The medial axis
// of a rasterized curved stroke carries exactly that residue — a ±0.3 px
// radial beat with a several-pixel period from the pixel lattice — and
// Douglas-Peucker then anchors its output vertices on the beat's EXTREMES,
// baking the wobble into the final polyline (measured: ±0.71 px around an
// ideal-circle stroke's true centerline).
//
// The fix is a windowed least-squares quadratic fit of x(t) and y(t) over
// arc length (Savitzky-Golay on a curve): a parabola matches any constant-
// curvature arc to second order, so genuine turns — including small letter
// bowls — keep their radius (no Laplacian melt), while uncorrelated ripple
// inside the window cancels. Every vertex is bounded to move at most
// MAX_FAIRING_SHIFT_PX, the same sub-pixel scale the simplifier already
// treats as noise; corners, hard turns, and open endpoints are pinned via
// the shared anchor classification and returned as their original objects.

import type { Vec2 } from '../../scene';
import { classifyAnchors } from './chain-smoothing';

// Noise amplitude bound: matches SIMPLIFY_EPSILON_PX in stroke-chains.ts —
// anything the fairing moves farther than this is signal, not lattice ripple.
const MAX_FAIRING_SHIFT_PX = 0.45;
// Window half-width in arc-length px. The lattice beat's wavelength scales
// with the CURVE radius — a rasterized circle of radius R crosses pixel rows
// at spacings up to ~sqrt(2R) near its axis-aligned quadrants — so the window
// tracks sqrt(local curve radius), clamped so tight glyph bowls (small R,
// small window) never average across a genuine feature.
const MIN_HALF_WINDOW_PX = 3;
const MAX_HALF_WINDOW_PX = 14;
const WINDOW_PER_SQRT_RADIUS = 1.3;
// Curve-radius probe distance along the chain (each side of the vertex).
const CURVATURE_PROBE_PX = 8;
// A quadratic fit needs headroom beyond its 3 degrees of freedom.
const MIN_WINDOW_SAMPLES = 5;
// One pass attenuates the beat ~4×; a second takes the residual below the
// simplifier's noise floor. The displacement cap is enforced against the
// ORIGINAL vertex across passes, so iterating never grows the total shift.
const FAIRING_PASSES = 2;

export function fairChainAlongArc(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  anchors: ReadonlySet<Vec2>,
): Vec2[] {
  const n = points.length;
  if (n < MIN_WINDOW_SAMPLES) return [...points];
  const pinned = classifyAnchors(points, closed, anchors);
  let current: Vec2[] = [...points];
  for (let pass = 0; pass < FAIRING_PASSES; pass += 1) {
    const arc = cumulativeArcLength(current, closed);
    const total = arc[n] ?? 0;
    if (total <= 0) return current;
    current = current.map((p, i) => {
      const original = points[i];
      if (pinned[i] === true || original === undefined) return p;
      const halfWindow = halfWindowAt(current, arc, total, closed, i);
      const faired = fitQuadraticAt(current, arc, total, closed, pinned, i, halfWindow);
      if (faired === null) return p;
      return capDisplacement(original, faired);
    });
  }
  return current;
}

// Window sized to the local curve radius via the circumradius of the vertex
// and two probes ±CURVATURE_PROBE_PX along the chain (Menger curvature). A
// straight span has infinite radius → max window; a tight bowl collapses the
// probe triangle → min window, which keeps genuine small features intact.
function halfWindowAt(
  points: ReadonlyArray<Vec2>,
  arc: ReadonlyArray<number>,
  total: number,
  closed: boolean,
  center: number,
): number {
  const p = points[center];
  const before = pointNearArcOffset(points, arc, total, closed, center, -CURVATURE_PROBE_PX);
  const after = pointNearArcOffset(points, arc, total, closed, center, CURVATURE_PROBE_PX);
  if (p === undefined || before === null || after === null) return MIN_HALF_WINDOW_PX;
  const a = Math.hypot(p.x - before.x, p.y - before.y);
  const b = Math.hypot(after.x - p.x, after.y - p.y);
  const c = Math.hypot(after.x - before.x, after.y - before.y);
  const area2 = Math.abs(
    (p.x - before.x) * (after.y - before.y) - (after.x - before.x) * (p.y - before.y),
  );
  const radius = area2 < 1e-9 ? Number.POSITIVE_INFINITY : (a * b * c) / (2 * area2);
  const window = WINDOW_PER_SQRT_RADIUS * Math.sqrt(Math.min(radius, 1e4));
  return Math.min(MAX_HALF_WINDOW_PX, Math.max(MIN_HALF_WINDOW_PX, window));
}

// The chain vertex closest to the requested signed arc offset from `center`
// (probe helper for the curvature estimate — vertex precision is plenty).
function pointNearArcOffset(
  points: ReadonlyArray<Vec2>,
  arc: ReadonlyArray<number>,
  total: number,
  closed: boolean,
  center: number,
  offset: number,
): Vec2 | null {
  const n = points.length;
  const dir = offset < 0 ? -1 : 1;
  const target = Math.abs(offset);
  for (let step = 1; step < n; step += 1) {
    const t = offsetArc(arc, total, closed, center, dir as -1 | 1, step);
    if (t === null) return null;
    if (Math.abs(t - (arc[center] ?? 0)) >= target) {
      const j = closed ? (((center + dir * step) % n) + n) % n : center + dir * step;
      return points[j] ?? null;
    }
  }
  return null;
}

// arc[i] = distance from vertex 0 to vertex i; arc[n] = total (closed loops
// include the wrap segment so window offsets can reach across the seam).
function cumulativeArcLength(points: ReadonlyArray<Vec2>, closed: boolean): number[] {
  const n = points.length;
  const arc = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    arc[i] = (arc[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const first = points[0] as Vec2;
  const last = points[n - 1] as Vec2;
  arc[n] = (arc[n - 1] ?? 0) + (closed ? Math.hypot(first.x - last.x, first.y - last.y) : 0);
  return arc;
}

// Weighted least-squares quadratic of x(t), y(t) over the window, evaluated
// at the center vertex. Windows never extend across a pinned vertex (a drawn
// corner is a genuine curvature discontinuity), and they stay SYMMETRIC: an
// asymmetric window near a pin biases the fit toward the long side (classic
// local-regression boundary bias — measured as heart-lobe roughness), so both
// sides are capped to the reach of the shorter one.
function fitQuadraticAt(
  points: ReadonlyArray<Vec2>,
  arc: ReadonlyArray<number>,
  total: number,
  closed: boolean,
  pinned: ReadonlyArray<boolean>,
  center: number,
  halfWindow: number,
): Vec2 | null {
  const reach = Math.min(
    pinFreeReach(arc, total, closed, pinned, center, -1, halfWindow),
    pinFreeReach(arc, total, closed, pinned, center, 1, halfWindow),
  );
  if (reach <= 0) return null;
  const n = points.length;
  const centerT = arc[center] ?? 0;
  const samples: Array<{ t: number; p: Vec2; w: number }> = [];
  const sigma = reach / 2;
  for (const dir of [-1, 1] as const) {
    for (let step = 1; step < n; step += 1) {
      const t = offsetArc(arc, total, closed, center, dir, step);
      if (t === null || Math.abs(t - centerT) > reach) break;
      const j = closed ? (((center + dir * step) % n) + n) % n : center + dir * step;
      const p = points[j];
      if (p === undefined) break;
      const dt = t - centerT;
      samples.push({ t: dt, p, w: Math.exp(-(dt * dt) / (2 * sigma * sigma)) });
    }
  }
  const self = points[center];
  if (self === undefined) return null;
  samples.push({ t: 0, p: self, w: 1 });
  if (samples.length < MIN_WINDOW_SAMPLES) return null;
  return solveQuadraticValue(samples);
}

// Arc distance from `center` to the nearest pinned vertex in `dir`, capped at
// halfWindow. The pin itself is included in the usable span (its position is
// trusted); everything beyond it is not.
function pinFreeReach(
  arc: ReadonlyArray<number>,
  total: number,
  closed: boolean,
  pinned: ReadonlyArray<boolean>,
  center: number,
  dir: -1 | 1,
  halfWindow: number,
): number {
  const n = pinned.length;
  const centerT = arc[center] ?? 0;
  for (let step = 1; step < n; step += 1) {
    const t = offsetArc(arc, total, closed, center, dir, step);
    if (t === null) {
      const edge = offsetArc(arc, total, closed, center, dir, step - 1);
      return edge === null ? 0 : Math.min(halfWindow, Math.abs(edge - centerT));
    }
    const distance = Math.abs(t - centerT);
    if (distance > halfWindow) return halfWindow;
    const j = closed ? (((center + dir * step) % n) + n) % n : center + dir * step;
    if (pinned[j] === true) return distance;
  }
  return halfWindow;
}

// Signed arc position of the vertex `step` places from `center` in direction
// `dir`, unwrapped across the closed seam so window distances stay monotone.
function offsetArc(
  arc: ReadonlyArray<number>,
  total: number,
  closed: boolean,
  center: number,
  dir: -1 | 1,
  step: number,
): number | null {
  const n = arc.length - 1;
  const raw = center + dir * step;
  if (!closed) {
    return raw < 0 || raw >= n ? null : (arc[raw] ?? null);
  }
  const wraps = Math.floor(raw / n);
  const index = raw - wraps * n;
  const base = arc[index];
  if (base === undefined) return null;
  return base + wraps * total;
}

// Normal equations for value = c0 + c1·t + c2·t² under weights; the faired
// point is (c0x, c0y). Falls back to null on a singular window (collinear
// duplicate t values collapse the system).
function solveQuadraticValue(
  samples: ReadonlyArray<{ t: number; p: Vec2; w: number }>,
): Vec2 | null {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let bx0 = 0;
  let bx1 = 0;
  let bx2 = 0;
  let by0 = 0;
  let by1 = 0;
  let by2 = 0;
  for (const { t, p, w } of samples) {
    const t2 = t * t;
    s0 += w;
    s1 += w * t;
    s2 += w * t2;
    s3 += w * t2 * t;
    s4 += w * t2 * t2;
    bx0 += w * p.x;
    bx1 += w * t * p.x;
    bx2 += w * t2 * p.x;
    by0 += w * p.y;
    by1 += w * t * p.y;
    by2 += w * t2 * p.y;
  }
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s2 * s3) + s2 * (s1 * s3 - s2 * s2);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  // c0 by Cramer's rule (only the constant term is needed — the fit's value
  // at t = 0 IS c0).
  const c0x =
    (bx0 * (s2 * s4 - s3 * s3) - s1 * (bx1 * s4 - bx2 * s3) + s2 * (bx1 * s3 - bx2 * s2)) / det;
  const c0y =
    (by0 * (s2 * s4 - s3 * s3) - s1 * (by1 * s4 - by2 * s3) + s2 * (by1 * s3 - by2 * s2)) / det;
  if (!Number.isFinite(c0x) || !Number.isFinite(c0y)) return null;
  return { x: c0x, y: c0y };
}

function capDisplacement(original: Vec2, faired: Vec2): Vec2 {
  const dx = faired.x - original.x;
  const dy = faired.y - original.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= MAX_FAIRING_SHIFT_PX) return faired;
  const scale = MAX_FAIRING_SHIFT_PX / dist;
  return { x: original.x + dx * scale, y: original.y + dy * scale };
}
