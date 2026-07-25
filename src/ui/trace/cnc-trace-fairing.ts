// CNC machining policy for traced vectors (chatter audit, 2026-07-25).
// Trace output is px-denominated and tuned for visual fidelity; on CNC every
// vertex becomes a G1 endpoint, so pixel-pitch vertices with 15-25deg
// heading jitter put a 15-80 Hz lateral-impulse train into the machine at
// F300 — the measured chatter. At commit, and only when the project is CNC,
// the traced polylines are refaired in physical units. Laser commits pass
// the tracer's output through untouched.

import { fairToolpathPolylines } from '../../core/geometry';
import { polylineToCurveSubpath, type ColoredPath, type RasterImage } from '../../core/scene';

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

/** Fair a trace result for CNC execution. `traceWidthPx` is the trace
 *  raster's width; the traced vectors register pixel-for-pixel over the
 *  source bitmap (ADR-026), so the physical scale is the seed's mm width
 *  over that raster width. Rebuilds `curves` from the faired polylines —
 *  the CNC compiler flattens curves, not polylines, so stale curves would
 *  silently feed the machine the unfaired geometry. */
export function fairTracedPathsForCnc(
  paths: ReadonlyArray<ColoredPath>,
  seed: Pick<RasterImage, 'bounds'>,
  traceWidthPx: number,
): ColoredPath[] {
  const widthMm = seed.bounds.maxX - seed.bounds.minX;
  const mmPerPx = traceWidthPx > 0 ? widthMm / traceWidthPx : 0;
  return paths.map((path) => {
    const polylines = fairToolpathPolylines(path.polylines, {
      mmPerPx,
      minSegmentMm: CNC_TRACE_MIN_SEGMENT_MM,
      maxDeviationMm: CNC_TRACE_MAX_DEVIATION_MM,
      cornerAngleDeg: CNC_TRACE_CORNER_ANGLE_DEG,
    });
    return { ...path, polylines, curves: polylines.map(polylineToCurveSubpath) };
  });
}
