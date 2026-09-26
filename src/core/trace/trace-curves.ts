// Canonical curves for trace output (ADR-391, ADR-440). The contour finisher
// fits every ring with compact cubic and line segments; those segments become
// the path's curves, so compile and export flatten them once at their own
// tolerance. The curve rides EXPLICITLY on the ring object it describes
// (`TraceRing.curve`), through the topology repair, which keeps or swaps whole
// ring objects, to the output; a stage that builds a new ring builds it
// without a curve and gets straight segments over its points.

import {
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Vec2,
} from '../scene';
import { carrySubpathNesting } from '../scene/subpath-nesting';

/** A finished trace ring and, when it was fitted, its canonical curve. The
 *  points are the curve's compatibility sampling. */
export type TraceRing = Polyline & { readonly curve?: CurveSubpath };

// The centreline's fitted strokes (ADR-405), keyed by the exact sample array
// its finisher returns. A stage that copies the array falls back to straight
// segments over the copy.
const registeredCurves = new WeakMap<ReadonlyArray<Vec2>, CurveSubpath>();

/** A ring that carries its fitted curve. */
export function curvedTraceRing(points: ReadonlyArray<Vec2>, curve: CurveSubpath): TraceRing {
  return { points, closed: curve.closed, curve };
}

/** The curve a ring carries, if any. */
export function traceRingCurve(polyline: Polyline): CurveSubpath | undefined {
  return (polyline as TraceRing).curve;
}

/** Remember `curve` as the canonical curve of the exact sample array
 *  `points` (the centreline's fitted open and closed strokes, ADR-405). */
export function registerTraceCurve(points: ReadonlyArray<Vec2>, curve: CurveSubpath): void {
  registeredCurves.set(points, curve);
}

/** Give every trace path its canonical curves: the curve a ring carries, the
 *  centreline's registered curve, or straight segments over the polyline.
 *  Curves already present are kept. The output polylines are plain points,
 *  so a carried curve is never stored twice. */
export function withCanonicalTraceCurves(paths: ReadonlyArray<ColoredPath>): ColoredPath[] {
  return paths.map((path) => ({
    ...path,
    polylines: path.polylines.map(plainPolyline),
    curves:
      path.curves ??
      path.polylines.map(
        (polyline) =>
          traceRingCurve(polyline) ??
          registeredCurves.get(polyline.points) ??
          polylineToCurveSubpath(polyline),
      ),
  }));
}

function plainPolyline(polyline: Polyline): Polyline {
  return traceRingCurve(polyline) === undefined
    ? polyline
    : { points: polyline.points, closed: polyline.closed };
}

/** Map traced paths from a working grid back to source coordinates with
 *  independent axis scales, curves included (an affine map of a Bézier's
 *  control points is exact). A path holding an elliptical arc, which a
 *  non-uniform scale does not keep elliptical-arc-shaped in general, falls
 *  back to straight segments over its mapped polyline. */
export function scaleTracedPaths(
  paths: ReadonlyArray<ColoredPath>,
  scaleX: number,
  scaleY: number,
): ColoredPath[] {
  const map = (p: Vec2): Vec2 => ({ x: p.x * scaleX, y: p.y * scaleY });
  // A positive per-axis scale keeps every containment, so the forest carries.
  const scaled = withCanonicalTraceCurves(
    paths.map((path) => {
      const polylines = path.polylines.map((polyline) => ({
        closed: polyline.closed,
        points: polyline.points.map(map),
      }));
      const curves = path.curves;
      const mappable =
        curves !== undefined &&
        curves.length === polylines.length &&
        curves.every((curve) =>
          curve.segments.every((segment) => segment.kind !== 'elliptical-arc'),
        );
      return {
        color: path.color,
        polylines,
        ...(mappable ? { curves: curves.map((curve) => scaleCurve(curve, map)) } : {}),
      };
    }),
  );
  return scaled.map((path, index) => carrySubpathNesting(paths[index] as ColoredPath, path));
}

function scaleCurve(curve: CurveSubpath, map: (p: Vec2) => Vec2): CurveSubpath {
  const segments = curve.segments.map(
    (segment): PathSegment =>
      segment.kind === 'cubic'
        ? {
            kind: 'cubic',
            control1: map(segment.control1),
            control2: map(segment.control2),
            to: map(segment.to),
          }
        : { ...segment, to: map(segment.to) },
  );
  return { start: map(curve.start), closed: curve.closed, segments };
}
