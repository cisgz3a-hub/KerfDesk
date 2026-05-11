/**
 * T1-148: pure bezier-subdivision + 2D affine-transform helpers
 * extracted from JobCompiler. Pre-T1-148 these four primitives
 * (`subdivideCubic`, `subdivideQuadratic`, `applyTransform`,
 * `midpoint`) lived at the bottom of the 1156-line JobCompiler. They
 * are pure math — no scene, no compile-state — but exercising them
 * required loading every JobCompiler import.
 *
 * Both subdivision functions implement the classic adaptive
 * flatness-test recursion: split a bezier curve at t=0.5 (De
 * Casteljau) when the control-point chord exceeds `tolerance`,
 * otherwise emit just the endpoint. Hard-recursion cap at depth 10
 * (a 10-deep split is 2^10 = 1024 segments — far more than any real
 * geometry needs, and the cap guards against pathological control
 * points triggering infinite recursion).
 *
 * `applyTransform(p, m)` is the standard 2D affine multiply
 * (a/b/c/d/tx/ty layout). `midpoint(a, b)` is the literal arithmetic
 * mean. Both are tiny but used heavily inside JobCompiler's geometry
 * flattening.
 */
import type { Point, Matrix3x2 } from '../types';

/**
 * Recursively subdivide a cubic Bézier curve into line segments,
 * appending endpoints to `output`. Flatness test: the control-point
 * distance from the chord is < `tolerance × chord-length`. Depth is
 * hard-capped at 10 (emergency cutoff for pathological inputs).
 *
 * The first endpoint (`p0`) is NOT emitted — callers should push
 * it themselves before calling. Only subdivided endpoints / `p3` is
 * pushed.
 */
export function subdivideCubic(
  p0: Point, p1: Point, p2: Point, p3: Point,
  output: Point[], tolerance: number, depth = 0,
): void {
  if (depth > 10) {
    output.push({ ...p3 });
    return;
  }

  // Flatness test: are control points close to the line p0→p3?
  const dx = p3.x - p0.x, dy = p3.y - p0.y;
  const d1 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx);
  const d2 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx);
  const len = Math.sqrt(dx * dx + dy * dy);

  if ((d1 + d2) / (len || 1) < tolerance) {
    output.push({ ...p3 });
    return;
  }

  // De Casteljau subdivision at t=0.5
  const m01 = midpoint(p0, p1);
  const m12 = midpoint(p1, p2);
  const m23 = midpoint(p2, p3);
  const m012 = midpoint(m01, m12);
  const m123 = midpoint(m12, m23);
  const mid = midpoint(m012, m123);

  subdivideCubic(p0, m01, m012, mid, output, tolerance, depth + 1);
  subdivideCubic(mid, m123, m23, p3, output, tolerance, depth + 1);
}

/**
 * Recursively subdivide a quadratic Bézier curve into line segments.
 * Same shape as `subdivideCubic` but with one control point instead
 * of two. The first endpoint (`p0`) is NOT emitted.
 */
export function subdivideQuadratic(
  p0: Point, p1: Point, p2: Point,
  output: Point[], tolerance: number, depth = 0,
): void {
  if (depth > 10) {
    output.push({ ...p2 });
    return;
  }

  const dx = p2.x - p0.x, dy = p2.y - p0.y;
  const d = Math.abs((p1.x - p2.x) * dy - (p1.y - p2.y) * dx);
  const len = Math.sqrt(dx * dx + dy * dy);

  if (d / (len || 1) < tolerance) {
    output.push({ ...p2 });
    return;
  }

  const m01 = midpoint(p0, p1);
  const m12 = midpoint(p1, p2);
  const mid = midpoint(m01, m12);

  subdivideQuadratic(p0, m01, mid, output, tolerance, depth + 1);
  subdivideQuadratic(mid, m12, p2, output, tolerance, depth + 1);
}

/** 2D affine matrix-point multiply: `m * p`. */
export function applyTransform(p: Point, m: Matrix3x2): Point {
  return {
    x: m.a * p.x + m.c * p.y + m.tx,
    y: m.b * p.x + m.d * p.y + m.ty,
  };
}

/** Arithmetic mean of two points. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
