// Native arc moves for laser line cuts (ADR-407).
//
// Compile keeps every CutSegment polyline exactly as before: the chords of the
// canonical curve at the machine curve tolerance. When the machine accepts
// arcs, a line-mode segment also carries `arcMoves`, the same burn fitted from
// the canonical curve as lines and circular arcs within that tolerance, when
// that takes fewer moves, with a fingerprint of the polyline it was fitted
// against. The laser GRBL emitter writes those moves as G1/G2/G3; bounds, Frame
// and the preview read them too. Every reader goes through one predicate
// (emittedCutArcMoves), so a segment whose polyline a later stage rewrote
// without carrying the moves along falls back to its polyline everywhere, and
// the readers cannot disagree about which segments go out as arcs.

import { laserArcMovesEnabled } from '../devices/laser-arc-moves';
import { toMachineCoords, type DeviceProfile } from '../devices';
import { formatGcodeCoordinateMm } from '../gcode';
import {
  arcMovesConnect,
  arcSweep,
  extendBoundsByArcMoves,
  extendBoundsByCircularSweep,
  fitArcMoves,
  reverseArcMoves,
  sampleArcMoves,
  translateArcMoves,
  type ArcFitPlacement,
  type ArcMove,
  type ArcMoveBounds,
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
import type { CutArcMoves, CutSegment, Job } from './job';

/** Preview sampling of an arc: chords within 0.01 mm, below what a screen
 * shows at working zoom and finer than the 0.025 mm chords it replaces. */
const PREVIEW_ARC_SAGITTA_MM = 0.01;

// Fingerprint lengths are summed in a different order after reversal and
// translation; anything beyond float noise is a different polyline.
const FINGERPRINT_LENGTH_RELATIVE = 1e-9;
const FINGERPRINT_LENGTH_ABSOLUTE_MM = 1e-9;

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
  const last = segment.polyline[segment.polyline.length - 1];
  if (last === undefined || segment.polyline.length < 3) return segment;
  const fitted = fitArcMoves(curve, placement, DEFAULT_MACHINE_CURVE_TOLERANCE_MM);
  if (fitted.length === 0 || fitted.length >= segment.polyline.length - 1) return segment;
  // The fit ends on the mapped canonical end point; the compiled polyline may
  // end a float-noise step away (an elliptical arc's last sample, a closure
  // within CLOSURE_EPS_MM). Land exactly where the polyline does.
  const moves = fitted.map((move, index) =>
    index === fitted.length - 1 ? { ...move, to: last } : move,
  );
  return withCutArcMoves(segment, moves);
}

/** The segment carrying `moves` fingerprinted against its polyline, or the
 * segment without moves when they do not run from its first to its last point. */
export function withCutArcMoves<T extends CutSegment>(
  segment: T,
  moves: ReadonlyArray<ArcMove>,
): T {
  const from = segment.polyline[0];
  const last = segment.polyline[segment.polyline.length - 1];
  if (from === undefined || last === undefined || !arcMovesConnect(from, moves, last)) {
    return withoutArcMoves(segment);
  }
  const arcMoves: CutArcMoves = {
    moves,
    from,
    pointCount: segment.polyline.length,
    lengthMm: polylineLengthMm(segment.polyline),
  };
  return { ...segment, arcMoves };
}

/** The segment's arc moves while its polyline still matches the fingerprint
 * they were fitted against, else null. */
export function validCutArcMoves(segment: CutSegment): ReadonlyArray<ArcMove> | null {
  const stored = segment.arcMoves;
  if (stored === undefined) return null;
  const { polyline } = segment;
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  if (first === undefined || last === undefined) return null;
  if (first.x !== stored.from.x || first.y !== stored.from.y) return null;
  if (polyline.length !== stored.pointCount) return null;
  const slack = FINGERPRINT_LENGTH_ABSOLUTE_MM + stored.lengthMm * FINGERPRINT_LENGTH_RELATIVE;
  if (!(Math.abs(polylineLengthMm(polyline) - stored.lengthMm) <= slack)) return null;
  return arcMovesConnect(first, stored.moves, last) ? stored.moves : null;
}

/** How the laser output writes a group's contours (ADR-407). */
export type CutArcEmission = {
  /** laserArcMovesEnabled for the emitting machine. */
  readonly arcMovesEnabled: boolean;
  /** The group's ADR-239 entry runway; its ramp follows the first chord. */
  readonly entryRunwayMm?: number | undefined;
};

/**
 * The arc moves the laser GRBL emitter writes for this segment, or null when
 * it writes the polyline: arcs off for the machine, a tangential entry
 * runway, or no moves matching the polyline. Emitter, bounds and preview all
 * decide through this one predicate.
 */
export function emittedCutArcMoves(
  segment: CutSegment,
  emission: CutArcEmission,
): ReadonlyArray<ArcMove> | null {
  if (!emission.arcMovesEnabled || emission.entryRunwayMm !== undefined) return null;
  return validCutArcMoves(segment);
}

/** Whether any contour of the job goes out as arcs on an arc-enabled machine. */
export function jobWritesArcMoves(job: Job): boolean {
  return job.groups.some(
    (group) =>
      (group.kind === 'cut' || (group.kind === 'fill' && group.fillStyle === 'offset')) &&
      group.segments.some(
        (segment) =>
          emittedCutArcMoves(segment, {
            arcMovesEnabled: true,
            entryRunwayMm: group.entryRunwayMm,
          }) !== null,
      ),
  );
}

/** The burn path as drawn: arcs sampled finely, otherwise the polyline. */
export function cutSegmentBurnPolyline(
  segment: CutSegment,
  emission: CutArcEmission,
): ReadonlyArray<Vec2> {
  const moves = emittedCutArcMoves(segment, emission);
  const first = segment.polyline[0];
  if (moves === null || first === undefined) return segment.polyline;
  return sampleArcMoves(first, moves, PREVIEW_ARC_SAGITTA_MM);
}

type ArcMoveOf = Extract<ArcMove, { kind: 'arc' }>;

/** One arc as the emitter writes it and GRBL executes it. */
export type EmittedArc = {
  /** The I and J words, relative to the rounded start. */
  readonly i: string;
  readonly j: string;
  /** Centre and radius GRBL derives from the rounded start and I/J. */
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  /** Signed angular travel as mc_arc computes it (negative clockwise). */
  readonly travel: number;
};

const ARC_EMIT_RADIUS_SLACK_MM = 0.002;
// How far the rounded arc may run from the fitted one along its circle.
const ARC_EMIT_TRAVEL_SLACK_MM = 0.004;
// ARC_ANGULAR_TRAVEL_EPSILON in grbl/config.h (gnea/grbl master).
const GRBL_ARC_ANGULAR_TRAVEL_EPSILON = 5e-7;

/**
 * The arc from `from` as its rounded words would run on GRBL, or null when
 * those words would not reproduce it. The start is where the controller is:
 * the 3-decimal rounding of `from`. The rounded centre must put the rounded
 * end within ARC_EMIT_RADIUS_SLACK_MM of the start radius, far inside GRBL's
 * own 0.005 mm limit (gcode.c), and GRBL's angular travel (atan2, then a full
 * turn added when it reads the wrong way within ARC_ANGULAR_TRAVEL_EPSILON,
 * mc_arc) must match the fitted sweep, so rounding can never turn a sliver
 * into a near-full circle.
 */
export function emittedArc(from: Vec2, move: ArcMoveOf): EmittedArc | null {
  const head = {
    x: Number(formatGcodeCoordinateMm(from.x)),
    y: Number(formatGcodeCoordinateMm(from.y)),
  };
  const i = formatGcodeCoordinateMm(move.center.x - head.x);
  const j = formatGcodeCoordinateMm(move.center.y - head.y);
  const center = { x: head.x + Number(i), y: head.y + Number(j) };
  const rx = -Number(i);
  const ry = -Number(j);
  const tx = Number(formatGcodeCoordinateMm(move.to.x)) - center.x;
  const ty = Number(formatGcodeCoordinateMm(move.to.y)) - center.y;
  const radius = Math.hypot(rx, ry);
  if (!(radius > 0) || Math.abs(Math.hypot(tx, ty) - radius) > ARC_EMIT_RADIUS_SLACK_MM) {
    return null;
  }
  let travel = Math.atan2(rx * ty - ry * tx, rx * tx + ry * ty);
  if (move.clockwise && travel >= -GRBL_ARC_ANGULAR_TRAVEL_EPSILON) travel -= 2 * Math.PI;
  if (!move.clockwise && travel <= GRBL_ARC_ANGULAR_TRAVEL_EPSILON) travel += 2 * Math.PI;
  const intended = arcSweep(from, move.to, move.center, move.clockwise);
  if (radius * Math.abs(Math.abs(travel) - intended) > ARC_EMIT_TRAVEL_SLACK_MM) return null;
  return { i, j, center, radius, startAngle: Math.atan2(ry, rx), travel };
}

/**
 * Extends `bounds` by what GRBL executes for these moves: each fitted arc's
 * extrema (its fallback chords lie inside it), and each emitted arc's extrema
 * about the centre and radius its rounded words give. GRBL's chords lie inside
 * that circle, so the union holds every executed point; move ends are bounded
 * unrounded, as the G1 path's are.
 */
export function extendBoundsByEmittedArcMoves(
  bounds: ArcMoveBounds,
  start: Vec2,
  moves: ReadonlyArray<ArcMove>,
): void {
  extendBoundsByArcMoves(bounds, start, moves);
  let from = start;
  for (const move of moves) {
    const arc = move.kind === 'arc' ? emittedArc(from, move) : null;
    if (arc !== null) {
      extendBoundsByCircularSweep(bounds, arc.center, arc.radius, arc.startAngle, arc.travel);
    }
    from = move.to;
  }
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
  const moved = { ...withoutArcMoves(segment), polyline };
  return moves === null ? moved : withCutArcMoves(moved, translateArcMoves(moves, dx, dy));
}

/** Reverses the polyline and any arc moves together. */
export function reverseCutSegment<T extends CutSegment>(segment: T): T {
  const polyline = [...segment.polyline].reverse();
  const moves = validCutArcMoves(segment);
  const first = segment.polyline[0];
  const reversed = { ...withoutArcMoves(segment), polyline };
  if (moves === null || first === undefined) return reversed;
  return withCutArcMoves(reversed, reverseArcMoves(first, moves));
}

function polylineLengthMm(polyline: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < polyline.length; index += 1) {
    const a = polyline[index - 1] as Vec2;
    const b = polyline[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
