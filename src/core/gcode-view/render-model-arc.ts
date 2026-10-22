import { ARC_EPSILON, arcSweepAngle, type GcodeWordMatch } from '../gcode';
import { arcAabb } from '../invariants/arc-bounds';
import { timingArcPoints } from './controller-arc-points';
import { isLaserOffFeed, renderedPower, type LaserRenderState } from './laser-render-state';
import { arcRadiusMismatch, renderArcCenter } from './render-model-arc-center';
import { applyLineWords, type RenderModal } from './render-model-words';
import { resolveTarget } from './render-model-coordinates';
import type { SegmentBuilder } from './segment-builder';
import type { ProgramBoundsTracker } from './program-bounds';
import { SEG_KIND, SEG_MOTION, type SkippedMotion } from './render-model-types';

const AXIS_EPSILON = 1e-9;
const XY_PLANE = 17;

type ArcContext = {
  readonly modal: RenderModal;
  readonly laser: LaserRenderState;
  readonly stockGrbl: boolean;
  readonly controllerArcToleranceMm: number | undefined;
  readonly program: ProgramBoundsTracker;
  readonly segments: SegmentBuilder;
  readonly skipped: SkippedMotion[];
  controllerArcBudgetRelief: number;
};

/** Validate known XY arc geometry before committing this block's modes or
 * tool events. This does not attempt firmware-dependent/stateful validation. */
export function grblArcBlockRejection(
  before: RenderModal,
  words: ReadonlyArray<GcodeWordMatch>,
  knownPosition = true,
): string | null {
  if (!commandsArc(before, words)) return null;
  const modal = { ...before };
  const { axisWords } = applyLineWords(modal, words, 0, {
    countUnsupported: () => undefined,
    pushEvent: () => undefined,
  });
  if (modal.motion < 2) return null;
  if (
    words.some(
      (word) =>
        word.letter === 'G' &&
        [10, 28, 30, 38.2, 38.3, 38.4, 38.5, 43.1, 49, 53, 80, 92].includes(word.value),
    )
  )
    return null;
  // GRBL requires an XYZ word in the selected plane, even for an I/J full
  // circle. Validate this before geometry, including when the start is unknown.
  const planeAxes = modal.plane === 17 ? 'XY' : modal.plane === 18 ? 'XZ' : 'YZ';
  if (!words.some((word) => planeAxes.includes(word.letter))) {
    return `arc requires axis words in the active G${modal.plane} plane`;
  }
  if (modal.plane !== 17 || !knownPosition) return null;
  const target = resolveTarget(modal, axisWords);
  const solved = renderArcCenter(
    axisWords,
    modal,
    target,
    modal.motion === 2,
    modal.unitScale,
    true,
  );
  if ('skipped' in solved) return solved.skipped;
  const radius = Math.hypot(modal.x - solved.center.x, modal.y - solved.center.y);
  const endRadius = Math.hypot(target.x - solved.center.x, target.y - solved.center.y);
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

export function emitArc(
  context: ArcContext,
  axisWords: ReadonlyMap<string, number>,
  target: { x: number; y: number; z: number },
  line: number,
): boolean {
  const { modal } = context;
  if (modal.plane !== XY_PLANE) {
    context.program.forget([]);
    context.skipped.push({ line, reason: 'G18/G19 plane arcs are not renderable (XY only)' });
    return false;
  }
  const clockwise = modal.motion === 2;
  const from = { x: modal.x, y: modal.y };
  const solved = renderArcCenter(
    axisWords,
    from,
    target,
    clockwise,
    modal.unitScale,
    context.stockGrbl,
  );
  if ('skipped' in solved) {
    context.skipped.push({ line, reason: solved.skipped });
    return false;
  }
  const { center } = solved;
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  const endRadius = Math.hypot(target.x - center.x, target.y - center.y);
  if (arcRadiusMismatch(radius, endRadius, context.stockGrbl)) {
    context.skipped.push({ line, reason: 'arc radius mismatch between start and end points' });
    return false;
  }
  if (radius <= ARC_EPSILON) {
    context.skipped.push({ line, reason: 'arc radius is zero' });
    return false;
  }
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const endAngle = Math.atan2(target.y - center.y, target.x - center.x);
  const samePoint =
    Math.abs(from.x - target.x) <= AXIS_EPSILON && Math.abs(from.y - target.y) <= AXIS_EPSILON;
  const sweep = arcSweepAngle(startAngle, endAngle, clockwise, samePoint);
  const arc = timingArcPoints(center, radius, startAngle, sweep, context.controllerArcToleranceMm);
  const points = arc.points;
  context.controllerArcBudgetRelief += arc.budgetRelief;
  points[points.length - 1] = { x: target.x, y: target.y };
  pushArcPairs(context, points, target, sweep * radius, line, clockwise);
  // The display's chords can cut inside the arc's outermost points, which the
  // controller's finer interpolation reaches. A Frame built from the program's
  // bounds must cover them (ADR-630), so the arc's exact box counts too.
  const box = arcAabb(from, target, center.x - from.x, center.y - from.y, clockwise);
  context.program.include({ x: box.minX, y: box.minY, z: modal.z });
  context.program.include({ x: box.maxX, y: box.maxY, z: modal.z });
  return true;
}

// Distributes the arc-true length (3D-helix-true when Z moves) across the
// sampled pairs by chord proportion so the cumulative route stays exact.
function pushArcPairs(
  context: ArcContext,
  points: ReadonlyArray<{ x: number; y: number }>,
  target: { x: number; y: number; z: number },
  signedArcLength: number,
  line: number,
  clockwise: boolean,
): void {
  const { modal } = context;
  const dz = target.z - modal.z;
  const planarLength = Math.abs(signedArcLength);
  const trueLength = Math.hypot(planarLength, dz);
  let chordTotal = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) chordTotal += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const denominator = Math.max(1, points.length - 1);
  let previous = { x: modal.x, y: modal.y, z: modal.z };
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const before = points[index - 1];
    if (point === undefined || before === undefined) continue;
    const z = modal.z + (dz * index) / denominator;
    const chord = Math.hypot(point.x - before.x, point.y - before.y);
    const share = chordTotal > 0 ? chord / chordTotal : 1 / denominator;
    context.segments.push({
      x0: previous.x,
      y0: previous.y,
      z0: previous.z,
      x1: point.x,
      y1: point.y,
      z1: z,
      kind: isLaserOffFeed(context.laser, modal) ? SEG_KIND.travel : SEG_KIND.cut,
      motion: clockwise ? SEG_MOTION.cw : SEG_MOTION.ccw,
      line,
      feed: modal.feed,
      power: renderedPower(context.laser, modal),
      lengthMm: trueLength * share,
    });
    previous = { x: point.x, y: point.y, z };
    // An arc is drawn about its start, so it counts where its start does.
    context.program.include(previous);
  }
}
