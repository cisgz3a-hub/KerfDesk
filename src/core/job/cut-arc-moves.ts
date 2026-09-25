// Native arc moves for laser line cuts (ADR-407).
//
// Compile keeps every CutSegment polyline exactly as before: the chords of the
// canonical curve at the machine curve tolerance. When the machine accepts
// arcs, a line-mode segment also carries `arcMoves`, the same burn fitted from
// the canonical curve as lines and circular arcs within that tolerance, when
// that takes fewer moves. The laser GRBL emitter writes those moves as G1/G2/G3;
// bounds, Frame and the preview read them too. Every reader goes through
// validCutArcMoves, so a segment whose polyline a later stage rewrote without
// carrying the moves along falls back to its polyline.

import { laserArcMovesEnabled } from '../devices/laser-arc-moves';
import { toMachineCoords, type DeviceProfile } from '../devices';
import {
  arcMovesConnect,
  fitArcMoves,
  reverseArcMoves,
  sampleArcMoves,
  translateArcMoves,
  type ArcFitPlacement,
  type ArcMove,
} from '../geometry/arc-fit';
import {
  applyTransform,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from '../scene';
import type { CutSegment } from './job';

/** Preview sampling of an arc: chords within 0.005 mm, far below what a screen shows. */
const PREVIEW_ARC_SAGITTA_MM = 0.005;

type SegmentArcFit = (index: number, segment: CutSegment) => CutSegment;

const NO_ARCS: SegmentArcFit = (_index, segment) => segment;

/**
 * For one path of a line-mode layer: attaches fitted arc moves to the
 * segment compiled from the path's `index`-th subpath, or returns the segment
 * untouched when the machine does not take arcs or they would not save moves.
 */
export function laserArcFitFor(
  path: ColoredPath,
  transform: Transform,
  device: DeviceProfile,
): SegmentArcFit {
  if (!laserArcMovesEnabled(device)) return NO_ARCS;
  const curves: ReadonlyArray<CurveSubpath> =
    path.curves ?? path.polylines.map((polyline) => polylineToCurveSubpath(polyline));
  const placement: ArcFitPlacement = {
    map: (point) => toMachineCoords(applyTransform(point, transform), device),
    largestScale: Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY)),
  };
  return (index, segment) => {
    const curve = curves[index];
    return curve === undefined ? segment : withArcMoves(segment, curve, placement);
  };
}

function withArcMoves(
  segment: CutSegment,
  curve: CurveSubpath,
  placement: ArcFitPlacement,
): CutSegment {
  const first = segment.polyline[0];
  const last = segment.polyline[segment.polyline.length - 1];
  if (first === undefined || last === undefined || segment.polyline.length < 3) return segment;
  const fitted = fitArcMoves(curve, placement, DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
  if (fitted.length === 0 || fitted.length >= segment.polyline.length - 1) return segment;
  // The fit ends on the mapped canonical end point; the compiled polyline may
  // end a float-noise step away (an elliptical arc's last sample, a closure
  // within CLOSURE_EPS_MM). Land exactly where the polyline does.
  const arcMoves = fitted.map((move, index) =>
    index === fitted.length - 1 ? { ...move, to: last } : move,
  );
  return arcMovesConnect(first, arcMoves, last) ? { ...segment, arcMoves } : segment;
}

/** The segment's arc moves when they still describe its polyline, else null. */
export function validCutArcMoves(segment: CutSegment): ReadonlyArray<ArcMove> | null {
  const moves = segment.arcMoves;
  if (moves === undefined) return null;
  const first = segment.polyline[0];
  const last = segment.polyline[segment.polyline.length - 1];
  if (first === undefined || last === undefined) return null;
  return arcMovesConnect(first, moves, last) ? moves : null;
}

/** The burn path as drawn: arcs sampled finely, otherwise the polyline. */
export function cutSegmentBurnPolyline(segment: CutSegment): ReadonlyArray<Vec2> {
  const moves = validCutArcMoves(segment);
  const first = segment.polyline[0];
  if (moves === null || first === undefined) return segment.polyline;
  return sampleArcMoves(first, moves, PREVIEW_ARC_SAGITTA_MM);
}

/** A copy whose polyline a caller will replace: its arc moves no longer apply. */
export function withoutArcMoves<T extends CutSegment>(segment: T): T {
  if (segment.arcMoves === undefined) return segment;
  const { arcMoves: _stale, ...rest } = segment;
  return rest as unknown as T;
}

/** Translates the polyline and any arc moves together. */
export function translateCutSegment<T extends CutSegment>(segment: T, dx: number, dy: number): T {
  const polyline = segment.polyline.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  const moves = validCutArcMoves(segment);
  if (moves === null) return { ...withoutArcMoves(segment), polyline };
  return { ...segment, polyline, arcMoves: translateArcMoves(moves, dx, dy) };
}

/** Reverses the polyline and any arc moves together. */
export function reverseCutSegment<T extends CutSegment>(segment: T): T {
  const polyline = [...segment.polyline].reverse();
  const moves = validCutArcMoves(segment);
  const first = segment.polyline[0];
  if (moves === null || first === undefined) return { ...withoutArcMoves(segment), polyline };
  return { ...segment, polyline, arcMoves: reverseArcMoves(first, moves) };
}
