// CNC machining policy for traced vectors (chatter audit, 2026-07-25).
// Trace output is px-denominated and tuned for visual fidelity; on CNC every
// vertex becomes a G1 endpoint, so pixel-pitch vertices with 15-25deg
// heading jitter put a 15-80 Hz lateral-impulse train into the machine at
// F300 — the measured chatter. At commit, and only when the project is CNC,
// the traced polylines are refaired in physical units. Laser commits keep
// their geometry within the machine curve tolerance instead
// (laser-trace-moves.ts, ADR-391).

import { fairToolpathPolylines } from '../../core/geometry';
import {
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { preparePolylineContactsSteps, weldOpenPolylines } from '../../core/toolpath';
import { runTraceSteps, type TraceSteps } from '../../core/trace/trace-steps';

// Target G1 chord away from drawn corners. Audit band 0.3-0.5 mm; 0.4 mm
// keeps the impulse rate below ~12 Hz at the F300 default while the chord
// sagitta on a 4 mm-radius feature stays under 5 um. The continuous 0.05 mm
// boundary-fidelity budget takes precedence when both cannot coexist.
const CNC_TRACE_MIN_SEGMENT_MM = 0.4;
// How far fairing may move the cut off the traced boundary. Covers the
// +-0.045 mm quantization jitter at the 254-DPI import default and stays far
// below any endmill radius.
const CNC_TRACE_MAX_DEVIATION_MM = 0.05;
// The tree-wide hard-corner convention (sharpener / curve-refine / dense
// corner detection all pin at 60 degrees).
const CNC_TRACE_CORNER_ANGLE_DEG = 60;
// Weld gap for fragmented open chains (Centerline / Edge pieces): crack-scale.
// The tracer's own bridge joins gaps to 3 px (0.3 mm at the 254-DPI default);
// this catches the scan cracks it missed, while staying well under dash-scale
// (~>=1 mm) so drawn dashes and dots are never joined or deleted.
const CNC_TRACE_WELD_GAP_MM = 0.5;

/** Fair a trace result for CNC execution using its placement scale at commit.
 *  Rebuilds `curves` from the faired polylines because the CNC compiler
 *  flattens curves, not the compatibility polyline view. */
export function fairTracedPathsForCnc(
  paths: ReadonlyArray<ColoredPath>,
  placement: Transform,
): ColoredPath[] {
  return runTraceSteps(fairTracedPathsForCncSteps(paths, placement));
}

/** fairTracedPathsForCnc as resumable steps, with a checkpoint after each
 *  whole-drawing pass and after each faired polyline. Fairing is a pure
 *  per-polyline map, so fairing them one at a time is the same computation. */
export function* fairTracedPathsForCncSteps(
  paths: ReadonlyArray<ColoredPath>,
  placement: Transform,
): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  const metric = physicalMetricForPlacement(placement);
  const sourcePolylines = paths.flatMap((path) => path.polylines);
  const contacts =
    metric === null
      ? { polylines: sourcePolylines, pinnedPoints: new Set<Vec2>() }
      : yield* preparePolylineContactsSteps(sourcePolylines);
  let offset = 0;
  const faired: ColoredPath[] = [];
  for (const path of paths) {
    if (cooperate) yield;
    const prepared = contacts.polylines.slice(offset, offset + path.polylines.length);
    offset += path.polylines.length;
    const pinnedPoints = new Set<Vec2>();
    const metricPolylines =
      metric === null
        ? prepared
        : mapPolylinesToMetric(prepared, metric, contacts.pinnedPoints, pinnedPoints);
    // Weld first, then fair: joining fragments turns pecks into one cut, and
    // the fairing pass then smooths the stitch joints like any other vertex.
    const welded = weldOpenPolylines(metricPolylines, {
      mmPerPx: metric?.referenceMmPerUnit ?? 0,
      maxGapMm: CNC_TRACE_WELD_GAP_MM,
      retainedPoints: pinnedPoints,
    });
    const options = {
      mmPerPx: metric?.referenceMmPerUnit ?? 0,
      minSegmentMm: CNC_TRACE_MIN_SEGMENT_MM,
      maxDeviationMm: CNC_TRACE_MAX_DEVIATION_MM,
      cornerAngleDeg: CNC_TRACE_CORNER_ANGLE_DEG,
      pinnedPoints,
    };
    const fairedPolylines: Polyline[] = [];
    for (const polyline of welded) {
      if (cooperate) yield;
      fairedPolylines.push(...fairToolpathPolylines([polyline], options));
    }
    const polylines =
      metric === null ? fairedPolylines : mapPolylinesFromMetric(fairedPolylines, metric);
    faired.push({ ...path, polylines, curves: polylines.map(polylineToCurveSubpath) });
  }
  return faired;
}

type PhysicalMetric = {
  readonly xFactor: number;
  readonly yFactor: number;
  readonly referenceMmPerUnit: number;
};

function physicalMetricForPlacement(placement: Transform): PhysicalMetric | null {
  const scaleX = Math.abs(placement.scaleX);
  const scaleY = Math.abs(placement.scaleY);
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return null;
  }
  // Normalizing by the geometric mean preserves the established pixel-domain
  // corner window while Euclidean distance in this metric is exactly physical
  // distance divided by the reference scale. Rotation and mirrors are
  // isometries, so they do not change the fairing result.
  const referenceMmPerUnit = Math.sqrt(scaleX) * Math.sqrt(scaleY);
  const xFactor = scaleX / referenceMmPerUnit;
  const yFactor = scaleY / referenceMmPerUnit;
  if (
    !Number.isFinite(referenceMmPerUnit) ||
    referenceMmPerUnit <= 0 ||
    !Number.isFinite(xFactor) ||
    !Number.isFinite(yFactor)
  ) {
    return null;
  }
  return {
    xFactor,
    yFactor,
    referenceMmPerUnit,
  };
}

function mapPolylinesToMetric(
  polylines: ReadonlyArray<Polyline>,
  metric: PhysicalMetric,
  sourcePins: ReadonlySet<Vec2>,
  mappedPins: Set<Vec2>,
): Polyline[] {
  return polylines.map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) => {
      const mapped = { x: point.x * metric.xFactor, y: point.y * metric.yFactor };
      if (sourcePins.has(point)) mappedPins.add(mapped);
      return mapped;
    }),
  }));
}

function mapPolylinesFromMetric(
  polylines: ReadonlyArray<Polyline>,
  metric: PhysicalMetric,
): Polyline[] {
  return polylines.map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) => ({
      x: point.x / metric.xFactor,
      y: point.y / metric.yFactor,
    })),
  }));
}
