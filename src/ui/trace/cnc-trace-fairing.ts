// CNC machining policy for traced vectors (chatter audit, 2026-07-25).
// Trace output is px-denominated and tuned for visual fidelity; on CNC every
// vertex becomes a G1 endpoint, so pixel-pitch vertices with 15-25deg
// heading jitter put a 15-80 Hz lateral-impulse train into the machine at
// F300 — the measured chatter. At commit, and only when the project is CNC,
// the traced polylines are refaired in physical units. Laser commits pass
// the tracer's output through untouched.

import { fairToolpathPolylines } from '../../core/geometry';
import {
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
  type Transform,
} from '../../core/scene';
import { weldOpenPolylines } from '../../core/toolpath';

// Minimum G1 chord away from drawn corners. Audit band 0.3-0.5 mm; 0.4 mm
// keeps the impulse rate below ~12 Hz at the F300 default while the chord
// sagitta on a 4 mm-radius feature stays under 5 um.
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
  const metric = physicalMetricForPlacement(placement);
  return paths.map((path) => {
    const metricPolylines =
      metric === null ? [...path.polylines] : mapPolylinesToMetric(path.polylines, metric);
    // Weld first, then fair: joining fragments turns pecks into one cut, and
    // the fairing pass then smooths the stitch joints like any other vertex.
    const welded = weldOpenPolylines(metricPolylines, {
      mmPerPx: metric?.referenceMmPerUnit ?? 0,
      maxGapMm: CNC_TRACE_WELD_GAP_MM,
    });
    const faired = fairToolpathPolylines(welded, {
      mmPerPx: metric?.referenceMmPerUnit ?? 0,
      minSegmentMm: CNC_TRACE_MIN_SEGMENT_MM,
      maxDeviationMm: CNC_TRACE_MAX_DEVIATION_MM,
      cornerAngleDeg: CNC_TRACE_CORNER_ANGLE_DEG,
    });
    const polylines = metric === null ? faired : mapPolylinesFromMetric(faired, metric);
    return { ...path, polylines, curves: polylines.map(polylineToCurveSubpath) };
  });
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
): Polyline[] {
  return polylines.map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) => ({
      x: point.x * metric.xFactor,
      y: point.y * metric.yFactor,
    })),
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
