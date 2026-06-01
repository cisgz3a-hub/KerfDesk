import type { ColoredPath, Polyline } from '../scene';
import { lightBurnTraceBitmapFromImage } from './potrace-bitmap';
import { potraceCurveToPolylinePoints, smoothClosedPolygonToPotraceCurve } from './potrace-curve';
import { optimizePotraceCurve } from './potrace-curve-optimize';
import { lightBurnTraceSettingsToPotraceParams } from './potrace-params';
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
  if (options.ditherMode !== undefined && options.ditherMode !== 'none') return false;
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

  return polylines.length === 0 ? [] : [{ color: POTRACE_COLOR, polylines }];
}
