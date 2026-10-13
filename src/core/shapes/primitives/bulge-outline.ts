// Bulged polygon and star sides (LightBurn shape properties). Bulge b in
// [-1, 1] turns every straight side into a circular arc whose sagitta is
// b x half the side's length: b = 1 is a half circle bowing outward, b = -1
// one bowing inward, 0 the straight side. The arcs are exact elliptical-arc
// segments, so the outline needs no fitting. Vertices run in the shapes'
// positive-angle order, so an outward bow sweeps the positive way.

import {
  curveSubpathBounds,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
} from '../../scene';
import { boundsOfPolylines } from '../polyline-bounds';

export const MAX_BULGE = 1;

export function clampBulge(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(MAX_BULGE, Math.max(-MAX_BULGE, value));
}

/** The closed outline through `polyline`'s vertices with every side bulged. */
export function bulgedOutline(polyline: Polyline, bulge: number): CurveSubpath {
  const straight = polylineToCurveSubpath(polyline);
  const b = clampBulge(bulge);
  if (b === 0) return straight;
  let from = straight.start;
  const segments = straight.segments.map((segment): PathSegment => {
    const start = from;
    from = segment.to;
    const chord = Math.hypot(segment.to.x - start.x, segment.to.y - start.y);
    if (chord === 0) return segment;
    const radius = ((chord / 4) * (1 + b * b)) / Math.abs(b);
    return {
      kind: 'elliptical-arc',
      radiusX: radius,
      radiusY: radius,
      rotationDeg: 0,
      largeArc: false,
      sweep: b > 0,
      to: segment.to,
    };
  });
  return { ...straight, segments };
}

/** Paths and bounds for a closed regular outline, straight or bulged. */
export function outlineGeometry(
  color: string,
  polylines: ReadonlyArray<Polyline>,
  bulge: number | undefined,
): { readonly paths: ReadonlyArray<ColoredPath>; readonly bounds: Bounds } {
  const b = clampBulge(bulge);
  if (b === 0) {
    return {
      paths: [{ color, polylines, curves: polylines.map(polylineToCurveSubpath) }],
      bounds: boundsOfPolylines(polylines),
    };
  }
  const curves = polylines.map((polyline) => bulgedOutline(polyline, b));
  const flat = curves.map((curve, index) => {
    const result = flattenCurveSubpath(curve, { toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM });
    return result.kind === 'ok' ? result.polyline : (polylines[index] as Polyline);
  });
  const boxes = curves.map(curveSubpathBounds);
  const bounds = boxes.reduce((box, next) => ({
    minX: Math.min(box.minX, next.minX),
    minY: Math.min(box.minY, next.minY),
    maxX: Math.max(box.maxX, next.maxX),
    maxY: Math.max(box.maxY, next.maxY),
  }));
  return { paths: [{ color, polylines: flat, curves }], bounds };
}
