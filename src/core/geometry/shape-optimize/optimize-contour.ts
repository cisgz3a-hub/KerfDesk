// Optimize Shapes on one contour (LightBurn gap LBG-T22): sample it in world
// millimetres, find its corners, smooth each run between them, fit the runs
// with lines, arcs and cubics, and bring the pieces back into the object's own
// coordinates as its exact curve. Corners and the ends of an open contour stay
// exactly where they were; a closed contour stays closed.
//
// A contour whose result would neither move nor get simpler is returned as it
// was. Without smoothing, a fit that is not simpler than the source is not
// used either, so fitting never makes a path bigger.

import { curveNodeCount } from '../../scene/curve-edit';
import { flattenCurveSubpath } from '../../scene/curve-path';
import type { CurveSubpath, PathSegment, Transform, Vec2 } from '../../scene/scene-object';
import { applyTransform } from '../../scene/transform';
import { contourCorners, contourRuns } from './contour-corners';
import { sampleContour, type ContourSamples } from './contour-samples';
import { inversePlacement, localSegment } from './local-pieces';
import { outlineDeviationMm } from './outline-deviation';
import { fitRun, type WorldPiece } from './run-fitting';
import { smoothRun } from './run-smoothing';
import type { ShapeOptimizeOptions } from './shape-optimize-options';

export type ContourOptimization = {
  /** The contour's new exact curve, or the source itself when nothing changed. */
  readonly curve: CurveSubpath;
  readonly changed: boolean;
  /** Points (curve nodes) the source had. */
  readonly sourcePoints: number;
  /** Segments the result has. */
  readonly segments: number;
  /** Farthest the outline moved, world mm (both ways). */
  readonly movedMm: number;
};

/** Without Fit, the smoothed outline is kept as lines joining points this close. */
const LINES_ONLY_TOLERANCE_MM = 0.002;
const MOVED_EPSILON_MM = 1e-6;

export function optimizeContour(
  source: CurveSubpath,
  transform: Transform,
  options: ShapeOptimizeOptions,
): ContourOptimization {
  const sourcePoints = curveNodeCount(source);
  const unchanged: ContourOptimization = {
    curve: source,
    changed: false,
    sourcePoints,
    segments: sourceSegmentCount(source),
    movedMm: 0,
  };
  if (!options.smooth && !options.fit) return unchanged;
  const sampleTolerance = sampleToleranceMm(options);
  const samples = sampleContour(source, transform, sampleTolerance);
  if (samples.points.length < (samples.closed ? 3 : 2)) return unchanged;
  const { start, pieces } = worldPieces(samples, options, sampleTolerance);
  if (pieces.length === 0) return unchanged;
  const curve = localCurve(start, pieces, samples.closed, transform);
  const movedMm = outlineDeviationMm(
    samples.points,
    samples.closed,
    worldPoints(curve, transform, sampleTolerance),
    samples.closed,
  );
  const segments = curve.segments.length;
  const simpler = segments < unchanged.segments;
  const moved = movedMm > MOVED_EPSILON_MM;
  if (options.smooth ? !simpler && !moved : !simpler) return unchanged;
  return { curve, changed: true, sourcePoints, segments, movedMm };
}

/** Samples are this close to the source's exact curves; the fit spends the rest. */
export function sampleToleranceMm(options: ShapeOptimizeOptions): number {
  return Math.min(0.01, Math.max(0.001, options.fitToleranceMm / 10));
}

function worldPieces(
  samples: ContourSamples,
  options: ShapeOptimizeOptions,
  sampleTolerance: number,
): { readonly start: Vec2; readonly pieces: WorldPiece[] } {
  const corners = contourCorners(
    samples,
    (options.cornerAngleDeg * Math.PI) / 180,
    noiseScale(options),
  );
  const tolerance = options.fit
    ? options.fitToleranceMm - sampleTolerance
    : LINES_ONLY_TOLERANCE_MM;
  const kinds = options.fit ? options.fitWith : 'lines';
  const pieces: WorldPiece[] = [];
  let start: Vec2 | null = null;
  for (const run of contourRuns(samples, corners)) {
    const points = options.smooth
      ? smoothRun(run.points, run.periodic, options.smoothingMm)
      : [...run.points];
    start ??= points[0] as Vec2;
    if (run.periodic) points.push(points[0] as Vec2);
    pieces.push(...fitRun(points, run.periodic, tolerance, kinds));
  }
  return { start: start ?? (samples.points[0] as Vec2), pieces };
}

// Detail finer than this is jitter to smooth or fit through, not a corner:
// the smoothing distance, or without smoothing the fit tolerance.
function noiseScale(options: ShapeOptimizeOptions): number {
  if (options.smooth) return options.smoothingMm;
  return options.fit ? options.fitToleranceMm : 0;
}

function localCurve(
  start: Vec2,
  pieces: ReadonlyArray<WorldPiece>,
  closed: boolean,
  transform: Transform,
): CurveSubpath {
  const inverse = inversePlacement(transform);
  const localStart = inverse.toLocal(start);
  const segments: PathSegment[] = pieces.map((piece) => localSegment(piece, inverse));
  const last = segments[segments.length - 1];
  // Close exactly: the last piece ends on the first point, bit for bit.
  if (closed && last !== undefined) segments[segments.length - 1] = { ...last, to: localStart };
  return { start: localStart, segments, closed };
}

function worldPoints(curve: CurveSubpath, transform: Transform, toleranceMm: number): Vec2[] {
  const largestScale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm: largestScale > 0 ? toleranceMm / largestScale : toleranceMm,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  const points = flattened.kind === 'ok' ? flattened.polyline.points : [curve.start];
  const world = points.map((point) => applyTransform(point, transform));
  if (curve.closed && world.length > 1) world.pop();
  return world;
}

function sourceSegmentCount(source: CurveSubpath): number {
  const end = source.segments[source.segments.length - 1]?.to ?? source.start;
  const closing = source.closed && (end.x !== source.start.x || end.y !== source.start.y) ? 1 : 0;
  return source.segments.length + closing;
}
