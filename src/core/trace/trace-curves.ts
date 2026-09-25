// Canonical curves for trace output (ADR-391). Where the contour finisher fits
// least-squares cubics, those cubics become the path's curves, so compile and
// export flatten them once at their own tolerance. Everything else keeps
// straight segments over its polyline.

import { polylineToCurveSubpath, type ColoredPath, type CurveSubpath, type Vec2 } from '../scene';
import { sampleCubics, type CubicBezier } from './fit-cubics';

// The fitter's cubics for each sampled ring, keyed by the exact sample array
// the finisher returns. The topology repair keeps or swaps whole arrays and
// never edits one, so a key that reaches the output still describes its own
// samples. A stage that copies the array loses only the curves: that ring
// falls back to straight segments over the same samples.
const fittedRingCurves = new WeakMap<ReadonlyArray<Vec2>, CurveSubpath>();

/** Sample fitted cubics as an explicitly closed ring, and remember the cubics
 *  as that ring's canonical curve. The samples are the ring the finisher has
 *  always returned: the closing point is the one the contour closure adds. */
export function fittedTraceRing(cubics: ReadonlyArray<CubicBezier>): Vec2[] {
  const points = sampleCubics(cubics, true);
  const first = points[0];
  const head = cubics[0];
  if (first === undefined || head === undefined) return points;
  points.push({ x: first.x, y: first.y });
  fittedRingCurves.set(points, {
    start: head.p0,
    closed: true,
    segments: cubics.map((cubic) => ({
      kind: 'cubic' as const,
      control1: cubic.p1,
      control2: cubic.p2,
      to: cubic.p3,
    })),
  });
  return points;
}

/** Remember `curve` as the canonical curve of the exact sample array
 *  `points` (the centreline's fitted open and closed strokes, ADR-397). The
 *  same identity rule applies: a stage that copies the array falls back to
 *  straight segments over the copy. */
export function registerTraceCurve(points: ReadonlyArray<Vec2>, curve: CurveSubpath): void {
  fittedRingCurves.set(points, curve);
}

/** Give every trace path its canonical curves: the fitter's cubics for rings
 *  that came from the fitter, straight segments over the polyline otherwise.
 *  Curves already present are kept. */
export function withCanonicalTraceCurves(paths: ReadonlyArray<ColoredPath>): ColoredPath[] {
  return paths.map((path) => ({
    ...path,
    curves:
      path.curves ??
      path.polylines.map(
        (polyline) => fittedRingCurves.get(polyline.points) ?? polylineToCurveSubpath(polyline),
      ),
  }));
}
