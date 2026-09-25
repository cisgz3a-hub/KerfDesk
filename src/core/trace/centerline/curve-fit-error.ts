// Two-way fit error for the centreline cubic fit (ADR-397): perpendicular
// distance from chain points to the curve, and from curve samples back to
// the chain.

import { evaluateCubic, newtonProjectionStep, type CubicBezier } from '../../geometry/cubic-fit';
import type { Vec2 } from '../../scene';
import { controlLength, distance, pointToSegment } from './cubic-geometry';

// The curve-to-chain check samples the cubic this finely (px of control
// polygon per sample).
const REVERSE_CHECK_STEP_PX = 0.5;
const REVERSE_WINDOW_BEHIND = 4;
const REVERSE_WINDOW_AHEAD = 12;
const PROJECTION_NEWTON_STEPS = 4;

export type FitError = { error: number; index: number };

// Perpendicular distance from every interior chain point to the curve: each
// parameter is refined by Newton projection (clamped to the segment), so the
// measure is the true point-to-curve distance, not the parametric residual.
export function orthogonalError(
  run: ReadonlyArray<Vec2>,
  cubic: CubicBezier,
  u: ReadonlyArray<number>,
): FitError & { params: number[] } {
  const params = [...u];
  let error = 0;
  let index = run.length >> 1;
  for (let i = 1; i < run.length - 1; i += 1) {
    const p = run[i] as Vec2;
    const t = projectParameter(cubic, p, u[i] as number);
    params[i] = t;
    const d = distance(evaluateCubic(cubic, t), p);
    if (d > error) {
      error = d;
      index = i;
    }
  }
  return { error, index, params };
}

// Distance from samples of the curve back to the chain polyline. The nearest
// chain segment advances monotonically with the curve parameter, so a sliding
// window keeps this linear in the run length.
export function reverseError(
  run: ReadonlyArray<Vec2>,
  cubic: CubicBezier,
  params: ReadonlyArray<number>,
): FitError {
  const samples = Math.max(4, Math.ceil(controlLength(cubic) / REVERSE_CHECK_STEP_PX));
  let segment = 0;
  let error = 0;
  let worstT = 0.5;
  for (let s = 1; s < samples; s += 1) {
    const q = evaluateCubic(cubic, s / samples);
    const lo = Math.max(0, segment - REVERSE_WINDOW_BEHIND);
    const hi = Math.min(run.length - 2, segment + REVERSE_WINDOW_AHEAD);
    let best = Infinity;
    for (let k = lo; k <= hi; k += 1) {
      const d = pointToSegment(q, run[k] as Vec2, run[k + 1] as Vec2);
      if (d < best) {
        best = d;
        segment = k;
      }
    }
    if (best > error) {
      error = best;
      worstT = s / samples;
    }
  }
  return { error, index: nearestParamIndex(params, worstT) };
}

function nearestParamIndex(params: ReadonlyArray<number>, t: number): number {
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < params.length; i += 1) {
    const gap = Math.abs((params[i] as number) - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

function projectParameter(cubic: CubicBezier, p: Vec2, t0: number): number {
  let t = t0;
  for (let step = 0; step < PROJECTION_NEWTON_STEPS; step += 1) {
    const raw = newtonProjectionStep(cubic, p, t);
    if (raw === null) break;
    const next = Math.min(1, Math.max(0, raw));
    if (Math.abs(next - t) < 1e-9) {
      t = next;
      break;
    }
    t = next;
  }
  return t;
}
