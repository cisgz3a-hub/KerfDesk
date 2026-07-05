import type { ColoredPath, Polyline } from '../scene';
import { snapCornersToInk } from './potrace-apex';
import { lightBurnTraceBitmapFromImage, type TraceBitmap } from './potrace-bitmap';
import { potraceCurveToPolylinePoints, smoothClosedPolygonToPotraceCurve } from './potrace-curve';
import { optimizePotraceCurve } from './potrace-curve-optimize';
import { lightBurnTraceSettingsToPotraceParams, type PotraceParams } from './potrace-params';
import { traceBitmapToPotracePaths } from './potrace-path-scanner';
import {
  adjustPotraceVertices,
  calculateBestPotracePolygon,
  calculatePotraceLongestStraightSegments,
} from './potrace-polygon';
import { type RawImageData, type TraceOptions, preprocessForTrace } from './trace-image';

const POTRACE_COLOR = '#000000';
const POTRACE_CUBIC_SAMPLES = 16;

export function shouldUsePotraceTraceBackend(options: TraceOptions): boolean {
  if (options.traceMode === 'centerline') return false;
  if (options.numberOfColors !== 2) return false;
  return options.fixedPalette?.length === 2;
}

export function traceImageToPotraceColoredPaths(
  image: RawImageData,
  options: TraceOptions,
): ColoredPath[] {
  const params = lightBurnTraceSettingsToPotraceParams(options);
  const prepared = preprocessForTrace(image, options);
  const bitmap = lightBurnTraceBitmapFromImage(prepared, {
    cutoffLuma: 0,
    thresholdLuma: 128,
    ignoreLessThanPixels: 0,
  });
  const apexSnapped = potraceBitmapToPolylines(bitmap, params);
  return apexSnapped.length === 0 ? [] : [{ color: POTRACE_COLOR, polylines: apexSnapped }];
}

/** The full potrace geometry stage on an already-binarized bitmap: path scan,
 *  polygon fit, curve smoothing, optional curve optimization, then apex
 *  snap-back against the same bitmap. Shared by every backend that can
 *  produce a bilevel ink mask (Line Art / Smooth / Sharp via luma threshold,
 *  Edge Detection via the local-contrast mask). */
export function potraceBitmapToPolylines(bitmap: TraceBitmap, params: PotraceParams): Polyline[] {
  const scannedPaths = traceBitmapToPotracePaths(bitmap, {
    turdsize: params.turdSize,
    turnpolicy: params.turnPolicy,
  });
  const polylines: Polyline[] = [];

  for (const path of scannedPaths) {
    const longestStraightSegments = calculatePotraceLongestStraightSegments(path.points);
    const polygon = calculateBestPotracePolygon(path.points, longestStraightSegments);
    let vertices = adjustPotraceVertices(path.points, polygon);
    if (path.sign === '-') vertices = [...vertices].reverse();
    if (vertices.length < 2) continue;

    const curve = smoothClosedPolygonToPotraceCurve(vertices, params.alphaMax);
    const optimizedCurve = params.optCurve
      ? optimizePotraceCurve(curve, params.optTolerance)
      : curve;
    const points = potraceCurveToPolylinePoints(optimizedCurve, POTRACE_CUBIC_SAMPLES);
    if (points.length >= 2) polylines.push({ points, closed: true });
  }

  // Recover sharp convex tips potrace's polygon stage blunts, snapping corner
  // vertices outward to the true ink apex in the same bitmap potrace scanned.
  return snapCornersToInk(polylines, bitmap);
}
