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
//                          curve both ways (bulge-arc-fit.ts, ADR-452)
//
// Input coordinates are the app's Y-down frame; bulge signs are already
// expressed for the Y-up frame the writer produces by mirroring Y.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import type {
  CurveSubpath,
  EllipticalArcPathSegment,
  PathSegment,
  Vec2,
} from '../scene/scene-object';
import { fittedCurveEdges, splitCircularBulge, type BulgeEdge } from './bulge-arc-fit';

export type BulgeVertex = { readonly x: number; readonly y: number; readonly bulge: number };
export type BulgeRing = { readonly vertices: ReadonlyArray<BulgeVertex>; readonly closed: boolean };

/** Published default: 0.01 mm, a tenth of a typical 0.1 mm laser spot. */
export const DEFAULT_DXF_CURVE_TOLERANCE_MM = 0.01;
/**
 * The arc fitter samples its source within 0.001 mm; a tighter request is
 * raised to it (the fit then falls back to those sample chords).
 */
const MIN_TOLERANCE_MM = 0.001;
const CIRCULAR_RELATIVE_EPSILON = 1e-9;

export function curveToBulgeRing(curve: CurveSubpath, toleranceMm: number): BulgeRing {
  const tolerance = Math.max(MIN_TOLERANCE_MM, toleranceMm);
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
    if (run.length > 0) addEdges(fittedCurveEdges(runStart, run, tolerance));
    run = [];
  };
  for (const segment of curve.segments) {
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

/** Distance from `p` to the closed segment a–b. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
