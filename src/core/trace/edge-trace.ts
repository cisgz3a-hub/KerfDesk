// Edge Detection trace: local-contrast ink mask → the own contour finisher.
//
// Two engines preceded this one. The Canny-chain engine (ADR-059)
// manufactured hooked serif tips and wandering contours in its geometry
// synthesis; ADR-115 replaced that stage with potrace geometry, whose apex
// snapping in turn stabbed spikes past small-letter feet and drew counters
// as pointed leaves (maintainer report, 2026-07-07). The geometry stage is
// now the SAME in-house contour finisher the filled-contours lane uses
// (contour-trace.ts: mid-crack boundary walk → corner-safe smoothing →
// straight-run flattening → bounded spline), so both lanes share one
// quality bar and the tree carries no potrace-derived code. What stays from
// ADR-115 is the detection half: the LOCAL-contrast ink mask (mkbitmap's
// design — catches the faint detail a global threshold drops, see
// local-contrast-mask.ts). Output remains closed contours only, matching
// LightBurn's trace semantics.
//
// The Canny-era option fields stay as the public knobs so the dialog,
// presets, and merge logic are untouched; the engine derives its two mask
// parameters from them (see edge-input.ts).

import type { ColoredPath, Polyline } from '../scene';
import {
  contourPolylinesFromMaskSteps,
  flattenStrengthFromSmoothness,
  optimizationToleranceScaleFromOptimize,
} from './contour-trace';
import { edgeTraceInputMatches, prepareEdgeTraceInput, type EdgeTraceInput } from './edge-input';
import { effectivePixelScale, type RawImageData, type TraceOptions } from './trace-image';
import { withCanonicalTraceCurves } from './trace-curves';
import { runTraceSteps, type TraceSteps } from './trace-steps';

const EDGE_COLOR = '#000000';
const DEFAULT_EDGE_MIN_LENGTH_PX = 3;
const MIN_EDGE_AREA_PX = 2;
// Same base simplification epsilon as the contour lane (see contour-trace).
const EDGE_SIMPLIFY_EPSILON_PX = 0.45;

export function traceImageToEdgePaths(image: RawImageData, options: TraceOptions): ColoredPath[] {
  return runTraceSteps(traceImageToEdgePathsSteps(image, options));
}

export function* traceImageToEdgePathsSteps(
  image: RawImageData,
  options: TraceOptions,
  preparedInput?: EdgeTraceInput,
): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  const input =
    preparedInput !== undefined && edgeTraceInputMatches(preparedInput, image, options)
      ? preparedInput
      : prepareEdgeTraceInput(image, options);
  const { bitmap, crackField } = input;
  // Pixel-denominated knobs keep SOURCE-pixel semantics on a supersampled
  // trace (same discipline as the filled-contour lane): the local-mean
  // radius and simplify ε scale by pixelScale, areas by its square. delta is
  // a luma contrast, scale-free.
  const scale = effectivePixelScale(options);
  // The same measured-boundary stack as the filled lane: the mask's iso-line
  // field gives sub-pixel vertex positions, which in turn lets the wobble
  // stages stand down and the fairing-by-fitting tail engage per loop.
  if (cooperate) yield;
  const toleranceScale = optimizationToleranceScaleFromOptimize(options.optimize);
  const finished = yield* contourPolylinesFromMaskSteps(
    { width: bitmap.width, height: bitmap.height, ink: bitmap.data },
    {
      // A tiny area floor prevents degenerate loops; the operator's Minimum
      // line value is applied to finished source-pixel path length below.
      minAreaPx: MIN_EDGE_AREA_PX * scale * scale,
      epsilonPx:
        EDGE_SIMPLIFY_EPSILON_PX *
        Math.max(0.1, options.lineTolerance ?? 1) *
        scale *
        toleranceScale,
      fitToleranceScale: toleranceScale,
      // Same Smoothness → flatten-strength ramp as the contour lane.
      flattenStrength: flattenStrengthFromSmoothness(options.smoothness),
      pixelScale: scale,
      crackField,
    },
  );
  const minimumLength = Math.max(0, options.edgeMinLengthPx ?? DEFAULT_EDGE_MIN_LENGTH_PX) * scale;
  const polylines = filterEdgePolylinesByLength(finished, minimumLength);
  return polylines.length === 0 ? [] : withCanonicalTraceCurves([{ color: EDGE_COLOR, polylines }]);
}

export function filterEdgePolylinesByLength(
  polylines: ReadonlyArray<Polyline>,
  minimumLengthPx: number,
): Polyline[] {
  if (!Number.isFinite(minimumLengthPx) || minimumLengthPx <= 0) return [...polylines];
  return polylines.filter((polyline) => polylineLength(polyline) >= minimumLengthPx);
}

function polylineLength(polyline: Polyline): number {
  let length = 0;
  for (let i = 1; i < polyline.points.length; i += 1) {
    const a = polyline.points[i - 1];
    const b = polyline.points[i];
    if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const first = polyline.points[0];
  const last = polyline.points[polyline.points.length - 1];
  if (polyline.closed && first !== undefined && last !== undefined) {
    length += Math.hypot(first.x - last.x, first.y - last.y);
  }
  return length;
}
