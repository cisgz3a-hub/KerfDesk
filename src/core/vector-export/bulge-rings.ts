// Canonical curves → polyline vertices with DXF bulges (ADR-431, ADR-452).
//
// DXF LWPOLYLINE vertices carry a bulge: tan(θ/4) of the included angle of a
// circular arc from that vertex to the next, positive when the arc turns
// counter-clockwise in the DXF (Y-up) frame, 0 for a straight edge.
//
//   * line               → one vertex, bulge 0 (exact)
//   * circular arc       → its exact bulge (no fitting), split into equal
//                          parts of at most a half circle each
//   * cubics and         → each run of consecutive ones is fitted with lines
//     elliptical arcs      and circular arcs within `toleranceMm` of the true
//                          curve both ways (bulge-arc-fit.ts, ADR-452), or
//                          written as ADR-431's chords (bulge-chords.ts) when
//                          those take fewer vertices or the tolerance is
//                          below the fitter's floor
//
// Non-finite curve coordinates throw instead of writing wrong geometry; a
// non-finite tolerance uses the default.
// Input coordinates are the app's Y-down frame; bulge signs are already
// expressed for the Y-up frame the writer produces by mirroring Y.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import type {
  CubicPathSegment,
  CurveSubpath,
  EllipticalArcPathSegment,
  PathSegment,
  Vec2,
} from '../scene/scene-object';
import { fittedCurveEdges, splitCircularBulge, type BulgeEdge } from './bulge-arc-fit';
import { chordCurveEdges } from './bulge-chords';

export { segmentDistance } from './bulge-chords';

export type BulgeVertex = { readonly x: number; readonly y: number; readonly bulge: number };
export type BulgeRing = { readonly vertices: ReadonlyArray<BulgeVertex>; readonly closed: boolean };

/** Published default: 0.01 mm, a tenth of a typical 0.1 mm laser spot. */
export const DEFAULT_DXF_CURVE_TOLERANCE_MM = 0.01;
/** ADR-431's floor: the chord subdivision holds any tolerance down to it. */
const MIN_TOLERANCE_MM = 1e-6;
/**
 * Smallest tolerance the arc fit gets: its source sampling (0.001 mm) and
 * rounding (0.002 mm) reserves leave it at least 0.001 mm of fit. Below it
 * every curved run is written as chords.
 */
export const MIN_ARC_FIT_TOLERANCE_MM = 0.004;
const CIRCULAR_RELATIVE_EPSILON = 1e-9;

export function curveToBulgeRing(curve: CurveSubpath, toleranceMm: number): BulgeRing {
  const tolerance = Number.isFinite(toleranceMm)
    ? Math.max(MIN_TOLERANCE_MM, toleranceMm)
    : DEFAULT_DXF_CURVE_TOLERANCE_MM;
  const vertices: { x: number; y: number; bulge: number }[] = [
    { x: curve.start.x, y: curve.start.y, bulge: 0 },
  ];
  const addEdges = (edges: ReadonlyArray<BulgeEdge>): void => {
    for (const edge of edges) {
      (vertices[vertices.length - 1] as { bulge: number }).bulge = edge.bulge;
      vertices.push({ x: edge.to.x, y: edge.to.y, bulge: 0 });
    }
  };
  let current = curve.start;
  let run: PathSegment[] = [];
  let runStart = current;
  const flushRun = (): void => {
    if (run.length > 0) addEdges(curvedRunEdges(runStart, run, tolerance));
    run = [];
  };
  for (const segment of curve.segments) {
    if (segment.kind !== 'line') assertFiniteCurve(current, segment);
    const bulge = segment.kind === 'elliptical-arc' ? circularBulge(current, segment) : null;
    if (segment.kind === 'line' || bulge !== null) {
      flushRun();
      addEdges(
        segment.kind === 'line' || bulge === 0
          ? [{ to: segment.to, bulge: 0 }]
          : splitCircularBulge(current, segment.to, bulge as number),
      );
    } else {
      if (run.length === 0) runStart = current;
      run.push(segment);
    }
    current = segment.to;
  }
  flushRun();
  return { vertices, closed: curve.closed };
}

// The fitted edges, unless chords take fewer vertices (radii outside the
// fitter's 0.1 to 1000 mm, or very flat curves) or the tolerance is too
// tight for the fit. Both hold the tolerance and end at the run's end.
function curvedRunEdges(
  from: Vec2,
  run: ReadonlyArray<PathSegment>,
  toleranceMm: number,
): ReadonlyArray<BulgeEdge> {
  const chords = chordCurveEdges(from, run, toleranceMm);
  if (toleranceMm < MIN_ARC_FIT_TOLERANCE_MM) return chords;
  const fitted = fittedCurveEdges(from, run, toleranceMm);
  return fitted.length <= chords.length ? fitted : chords;
}

function assertFiniteCurve(from: Vec2, segment: CubicPathSegment | EllipticalArcPathSegment): void {
  const values =
    segment.kind === 'cubic'
      ? [segment.control1.x, segment.control1.y, segment.control2.x, segment.control2.y]
      : [segment.radiusX, segment.radiusY, segment.rotationDeg];
  values.push(from.x, from.y, segment.to.x, segment.to.y);
  if (!values.every(Number.isFinite)) throw new Error('A curve has a non-finite coordinate.');
}

/**
 * Exact bulge for an arc that is circular after SVG radius correction, or
 * null for a true ellipse. A zero-length arc is omitted by SVG and has no
 * bulge; a zero radius is a straight line.
 */
export function circularBulge(from: Vec2, segment: EllipticalArcPathSegment): number | null {
  const rx = Math.abs(segment.radiusX);
  const ry = Math.abs(segment.radiusY);
  if (!(rx > 0) || !(ry > 0)) return 0;
  if (Math.abs(rx - ry) > CIRCULAR_RELATIVE_EPSILON * Math.max(rx, ry)) return null;
  const chord = Math.hypot(segment.to.x - from.x, segment.to.y - from.y);
  if (chord === 0) return 0;
  const radius = Math.max(rx, chord / 2);
  const small = 2 * Math.asin(Math.min(1, chord / (2 * radius)));
  const included = segment.largeArc ? 2 * Math.PI - small : small;
  // SVG sweep=1 turns toward +angle in the Y-down frame, which is clockwise
  // once Y is mirrored — a negative DXF bulge.
  return (segment.sweep ? -1 : 1) * Math.tan(included / 4);
}
