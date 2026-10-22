// G2/G3 arcs for the render model (ADR-255 stage 2), in whichever plane G17,
// G18 or G19 selects (ADR-630 Amendment 2). Split out of
// gcode-render-model-builder.ts, which drew XY arcs only and skipped the rest.
//
// GRBL (gcode.c) runs an arc in its plane's two axes, axis_0 and axis_1, and
// moves the third axis linearly: G17 is X,Y with offsets I,J and Z linear;
// G18 is Z,X with K,I and Y linear; G19 is Y,Z with J,K and X linear. mc_arc's
// clockwise test reads only axis_0 and axis_1, so the XY solve, sweep and box
// apply unchanged once each point is read in its plane's axes.

import { ARC_EPSILON, arcSweepAngle, type GcodeWordMatch } from '../gcode';
// Deep import: the exact arc box, also used by the output invariants.
import { arcAabb } from '../invariants/arc-bounds';
import { timingArcPoints } from './controller-arc-points';
import { isLaserOffFeed, renderedPower, type LaserRenderState } from './laser-render-state';
import type { ProgramBoundsTracker } from './program-bounds';
import { arcRadiusMismatch, renderArcCenter } from './render-model-arc-center';
import { resolveTarget } from './render-model-coordinates';
import { SEG_KIND, SEG_MOTION, type SkippedMotion } from './render-model-types';
import { applyLineWords, type RenderModal } from './render-model-words';
import type { SegmentBuilder } from './segment-builder';

const AXIS_EPSILON = 1e-9;

type Axis = 'x' | 'y' | 'z';
type Point = { readonly x: number; readonly y: number; readonly z: number };
type PlanePoint = { readonly x: number; readonly y: number };
type OffsetWord = 'I' | 'J' | 'K';

type ArcPlane = {
  readonly axis0: Axis;
  readonly axis1: Axis;
  readonly linear: Axis;
  /** The offset words along axis_0 and axis_1 (gcode.c ijk[axis_0], ijk[axis_1]). */
  readonly offset0: OffsetWord;
  readonly offset1: OffsetWord;
  /** How a skip reason names them. */
  readonly offsetNames: string;
};

const ARC_PLANES: Readonly<Record<RenderModal['plane'], ArcPlane>> = {
  17: { axis0: 'x', axis1: 'y', linear: 'z', offset0: 'I', offset1: 'J', offsetNames: 'I/J' },
  18: { axis0: 'z', axis1: 'x', linear: 'y', offset0: 'K', offset1: 'I', offsetNames: 'I/K' },
  19: { axis0: 'y', axis1: 'z', linear: 'x', offset0: 'J', offset1: 'K', offsetNames: 'J/K' },
};

/** What drawing an arc reads and writes of the builder's context. */
export type ArcContext = {
  readonly stockGrbl: boolean;
  readonly controllerArcToleranceMm: number | undefined;
  readonly laser: LaserRenderState;
  readonly modal: RenderModal;
  readonly segments: SegmentBuilder;
  readonly program: ProgramBoundsTracker;
  readonly skipped: SkippedMotion[];
  controllerArcBudgetRelief: number;
};

/** Validate known arc geometry before committing this block's modes or tool
 * events. The selected plane's axes must be placed, including its Z axis. */
export function grblArcBlockRejection(
  before: RenderModal,
  words: ReadonlyArray<GcodeWordMatch>,
  canPlace: ProgramBoundsTracker['canPlace'] = () => true,
): string | null {
  if (!commandsArc(before, words)) return null;
  const modal = { ...before };
  const { axisWords } = applyLineWords(modal, words, 0, {
    countUnsupported: () => undefined,
    pushEvent: () => undefined,
  });
  if (modal.motion < 2 || hasNonArcCommand(words)) return null;
  const plane = ARC_PLANES[modal.plane];
  // GRBL requires an axis word in the selected plane even for a full circle.
  // This structural requirement is independent of the starting position.
  if (!axisWords.has(plane.axis0.toUpperCase()) && !axisWords.has(plane.axis1.toUpperCase())) {
    return `arc requires axis words in the active G${modal.plane} plane`;
  }
  if (axisWords.has('R') && words.some((word) => 'IJK'.includes(word.letter))) {
    return 'R-form arc also supplies unused I/J/K offsets';
  }
  if (!canPlace([plane.axis0, plane.axis1])) return null;
  const from = inPlane(plane, modal);
  const to = inPlane(plane, resolveTarget(modal, axisWords));
  const solved = renderArcCenter(
    planeWords(plane, axisWords),
    from,
    to,
    modal.motion === 2,
    modal.unitScale,
    true,
    plane.offsetNames,
  );
  if ('skipped' in solved) return solved.skipped;
  const radius = Math.hypot(from.x - solved.center.x, from.y - solved.center.y);
  const endRadius = Math.hypot(to.x - solved.center.x, to.y - solved.center.y);
  return arcRadiusMismatch(radius, endRadius, true)
    ? 'arc radius mismatch between start and end points'
    : null;
}

function commandsArc(before: RenderModal, words: ReadonlyArray<GcodeWordMatch>): boolean {
  const explicit = words.some(
    (word) => word.letter === 'G' && [2, 3].includes(Math.round(word.value * 100) / 100),
  );
  return explicit || (before.motion >= 2 && words.some((word) => 'XYZ'.includes(word.letter)));
}

function hasNonArcCommand(words: ReadonlyArray<GcodeWordMatch>): boolean {
  return words.some(
    (word) =>
      word.letter === 'G' &&
      [10, 28, 30, 38.2, 38.3, 38.4, 38.5, 43.1, 49, 53, 80, 92].includes(word.value),
  );
}

/** Draws the G2/G3 from the modal position to `target`; false when it is skipped. */
export function emitArc(
  context: ArcContext,
  axisWords: ReadonlyMap<string, number>,
  target: Point,
  line: number,
): boolean {
  const { modal } = context;
  const plane = ARC_PLANES[modal.plane];
  const clockwise = modal.motion === 2;
  const start = { x: modal.x, y: modal.y, z: modal.z };
  const from = inPlane(plane, start);
  const to = inPlane(plane, target);
  const words = modal.plane === 17 ? axisWords : planeWords(plane, axisWords);
  const solved = renderArcCenter(
    words,
    from,
    to,
    clockwise,
    modal.unitScale,
    context.stockGrbl,
    plane.offsetNames,
  );
  if ('skipped' in solved) {
    context.skipped.push({ line, reason: solved.skipped });
    return false;
  }
  const { center } = solved;
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  const endRadius = Math.hypot(to.x - center.x, to.y - center.y);
  if (arcRadiusMismatch(radius, endRadius, context.stockGrbl)) {
    context.skipped.push({ line, reason: 'arc radius mismatch between start and end points' });
    return false;
  }
  if (radius <= ARC_EPSILON) {
    context.skipped.push({ line, reason: 'arc radius is zero' });
    return false;
  }
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
  const samePoint =
    Math.abs(from.x - to.x) <= AXIS_EPSILON && Math.abs(from.y - to.y) <= AXIS_EPSILON;
  const sweep = arcSweepAngle(startAngle, endAngle, clockwise, samePoint);
  const arc = timingArcPoints(center, radius, startAngle, sweep, context.controllerArcToleranceMm);
  const points = arc.points;
  context.controllerArcBudgetRelief += arc.budgetRelief;
  points[points.length - 1] = { x: to.x, y: to.y };
  pushArcPairs(context, plane, points, { start, target }, sweep * radius, line);
  // The display's chords can cut inside the arc's outermost points, which the
  // controller's finer interpolation reaches. A Frame built from the program's
  // bounds must cover them (ADR-630), so the arc's exact box counts too.
  const box = arcAabb(from, to, center.x - from.x, center.y - from.y, clockwise);
  const linear = start[plane.linear];
  context.program.include(fromPlane(plane, { x: box.minX, y: box.minY }, linear));
  context.program.include(fromPlane(plane, { x: box.maxX, y: box.maxY }, linear));
  return true;
}

function inPlane(plane: ArcPlane, point: Point): PlanePoint {
  return { x: point[plane.axis0], y: point[plane.axis1] };
}

function fromPlane(plane: ArcPlane, point: PlanePoint, linear: number): Point {
  const result = { x: 0, y: 0, z: 0 };
  result[plane.axis0] = point.x;
  result[plane.axis1] = point.y;
  result[plane.linear] = linear;
  return result;
}

// The plane's offsets as the I and J renderArcCenter reads. GRBL takes only
// the two in its plane and ignores the third (gcode.c clears all of I, J, K).
function planeWords(
  plane: ArcPlane,
  axisWords: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const words = new Map<string, number>();
  const offset0 = axisWords.get(plane.offset0);
  const offset1 = axisWords.get(plane.offset1);
  const radius = axisWords.get('R');
  if (offset0 !== undefined) words.set('I', offset0);
  if (offset1 !== undefined) words.set('J', offset1);
  if (radius !== undefined) words.set('R', radius);
  return words;
}

// Distributes the arc-true length (helix-true when the linear axis moves)
// across the sampled pairs by chord proportion so the cumulative route stays
// exact. The linear axis advances evenly per point, as mc_arc moves it.
function pushArcPairs(
  context: ArcContext,
  plane: ArcPlane,
  points: ReadonlyArray<PlanePoint>,
  ends: { readonly start: Point; readonly target: Point },
  signedArcLength: number,
  line: number,
): void {
  const { modal } = context;
  const linearStart = ends.start[plane.linear];
  const linearTravel = ends.target[plane.linear] - linearStart;
  const trueLength = Math.hypot(Math.abs(signedArcLength), linearTravel);
  let chordTotal = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) chordTotal += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const denominator = Math.max(1, points.length - 1);
  const kind = isLaserOffFeed(context.laser, modal) ? SEG_KIND.travel : SEG_KIND.cut;
  const motion = modal.motion === 2 ? SEG_MOTION.cw : SEG_MOTION.ccw;
  const power = renderedPower(context.laser, modal);
  let previous = ends.start;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const before = points[index - 1];
    if (point === undefined || before === undefined) continue;
    const next = fromPlane(plane, point, linearStart + (linearTravel * index) / denominator);
    const chord = Math.hypot(point.x - before.x, point.y - before.y);
    const share = chordTotal > 0 ? chord / chordTotal : 1 / denominator;
    context.segments.push({
      x0: previous.x,
      y0: previous.y,
      z0: previous.z,
      x1: next.x,
      y1: next.y,
      z1: next.z,
      kind,
      motion,
      line,
      feed: modal.feed,
      power,
      lengthMm: trueLength * share,
    });
    previous = next;
    // An arc is drawn about its start, so it counts where its start does.
    context.program.include(previous);
  }
}
