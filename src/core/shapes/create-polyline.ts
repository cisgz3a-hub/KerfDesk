// create-polyline — bridge from polyline geometry to a kind:'shape' SceneObject
// (ADR-051, Phase G, B6). Like create-polygon, bounds derive from the vertex
// extents; the pen places absolute scene-mm points, so callers pass
// IDENTITY_TRANSFORM (the default) and local space equals scene space.

import {
  curveSubpathBounds,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type ShapeObject,
  type Transform,
} from '../scene';
import { fairLineCurvePath } from '../geometry';
import { polylineToPolylines, type PolylineSpec } from './polyline';
import { boundsOfPolylines } from './polyline-bounds';
import { roundPolylineCurve } from './round-polyline-curve';

const DRAWING_FIT_TOLERANCE_RATIO = 0.02;
const MIN_DRAWING_FIT_TOLERANCE_MM = 0.25;
const MAX_DRAWING_FIT_TOLERANCE_MM = 3;
const MIN_OPEN_FAIRING_POINTS = 4;
const MIN_CLOSED_FAIRING_POINTS = 5;
type DrawingFairingMode = 'round' | 'corner-preserving';

// Bump when the drawing fairing engine (roundPolylineCurve / fairLineCurvePath
// / the fit tolerances above) changes in a way that should re-fair existing
// drawings. The migration re-fairs any drawing stamped below this and skips any
// stamped at it, so recognition never depends on re-deriving byte-identical
// fitter output (ADR-214).
export const CURRENT_POLYLINE_FAIRING_VERSION = 1;

export function createPolyline(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: PolylineSpec;
  readonly transform?: Transform;
  readonly fairingMode?: DrawingFairingMode;
}): ShapeObject {
  const sourcePolylines = polylineToPolylines(args.spec);
  const fairingMode = args.fairingMode ?? 'round';
  const geometry = sourcePolylines.map((polyline) => fairDrawingPolyline(polyline, fairingMode));
  const curves = geometry.map((item) => item.curve);
  const polylines = geometry.map((item) => item.polyline);
  const paths: ReadonlyArray<ColoredPath> = [{ color: args.color, polylines, curves }];
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'polyline', ...args.spec },
    color: args.color,
    bounds: boundsOfCurves(curves, polylines),
    transform: args.transform ?? IDENTITY_TRANSFORM,
    paths,
    fairingVersion: CURRENT_POLYLINE_FAIRING_VERSION,
  };
}

function fairDrawingPolyline(
  polyline: Polyline,
  fairingMode: DrawingFairingMode,
): { curve: CurveSubpath; polyline: Polyline } {
  const pointCount = polyline.points.length - (polyline.closed ? 1 : 0);
  const minimumPoints = polyline.closed ? MIN_CLOSED_FAIRING_POINTS : MIN_OPEN_FAIRING_POINTS;
  if (pointCount < minimumPoints) {
    return { curve: polylineToCurveSubpath(polyline), polyline };
  }
  const curve = materializeDrawingCurve(polyline, fairingMode);
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  });
  return {
    curve,
    polyline:
      flattened.kind === 'ok' ? { ...flattened.polyline, closed: polyline.closed } : polyline,
  };
}

function materializeDrawingCurve(
  polyline: Polyline,
  fairingMode: DrawingFairingMode,
): CurveSubpath {
  if (fairingMode === 'round') {
    return roundPolylineCurve(polyline, drawingFitTolerance(polyline.points));
  }
  return fairLineCurvePath(polylineToCurveSubpath(polyline), {
    fitToleranceUnits: drawingFitTolerance(polyline.points),
  });
}

function drawingFitTolerance(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): number {
  const bounds = boundsOfPolylines([{ points, closed: false }]);
  const diagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return Math.max(
    MIN_DRAWING_FIT_TOLERANCE_MM,
    Math.min(MAX_DRAWING_FIT_TOLERANCE_MM, diagonal * DRAWING_FIT_TOLERANCE_RATIO),
  );
}

function boundsOfCurves(
  curves: ReadonlyArray<CurveSubpath>,
  fallback: ReadonlyArray<Polyline>,
): Bounds {
  const first = curves[0];
  if (first === undefined) return boundsOfPolylines(fallback);
  return curves.slice(1).reduce((bounds, curve) => {
    const next = curveSubpathBounds(curve);
    return {
      minX: Math.min(bounds.minX, next.minX),
      minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX),
      maxY: Math.max(bounds.maxY, next.maxY),
    };
  }, curveSubpathBounds(first));
}
