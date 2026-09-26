// Centerline meaning of the trace dialog's Smoothness and Optimize (ADR-405).
// They keep the roles Potrace-style tracers give them — Smoothness is the
// corner threshold, Optimize the curve tolerance — applied to the centreline:
//
//  * Smoothness s sets the corner angle θ: a simplified vertex turning at
//    least θ stays an exact corner, gentler turns flow into the curve.
//    θ = 60°·s up to the neutral 1 (the tree-wide 60° corner), then rises to
//    150° at the maximum 4/3, where sharpener-marked corners turning less than
//    θ − 60° are released too. s = 0 keeps every simplified vertex: the
//    output is the simplified polygon.
//  * Optimize sets the fit tolerance: the largest distance the fitted cubics
//    may keep from the faired centreline, 0.25 source px at the neutral 0.2,
//    scaled by the shared Optimize curve (0.85x at 0, 2.35x at 2) and by
//    lineTolerance, as the contour and edge finishers scale theirs.

import { optimizationToleranceScaleFromOptimize } from '../trace-optimize';
import { effectivePixelScale, type TraceOptions } from '../trace-image';
import { DEFAULT_STROKE_FIT_TOLERANCE_PX, type StrokeCurvePolicy } from './stroke-output';

const NEUTRAL_SMOOTHNESS = 1;
const MAX_SMOOTHNESS = 4 / 3;
const NEUTRAL_CORNER_DEG = 60;
const MAX_CORNER_DEG = 150;
const DEG = Math.PI / 180;

export function strokeCurvePolicy(options: TraceOptions): StrokeCurvePolicy {
  const smoothness = finiteOr(options.smoothness, NEUTRAL_SMOOTHNESS);
  const fitTolerancePx =
    DEFAULT_STROKE_FIT_TOLERANCE_PX *
    optimizationToleranceScaleFromOptimize(options.optimize) *
    Math.max(0.1, finiteOr(options.lineTolerance, 1)) *
    effectivePixelScale(options);
  if (smoothness <= 0) return { fitTolerancePx, polygon: true };
  const cornerDeg = cornerAngleDeg(smoothness);
  return {
    fitTolerancePx,
    cornerAngleRad: cornerDeg * DEG,
    drawnCornerMinRad: Math.max(0, cornerDeg - NEUTRAL_CORNER_DEG) * DEG,
  };
}

/** The corner angle, in degrees, that Smoothness `s` selects. */
export function cornerAngleDeg(s: number): number {
  if (s <= NEUTRAL_SMOOTHNESS) return NEUTRAL_CORNER_DEG * Math.max(0, s);
  const above = Math.min(1, (s - NEUTRAL_SMOOTHNESS) / (MAX_SMOOTHNESS - NEUTRAL_SMOOTHNESS));
  return NEUTRAL_CORNER_DEG + (MAX_CORNER_DEG - NEUTRAL_CORNER_DEG) * above;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
