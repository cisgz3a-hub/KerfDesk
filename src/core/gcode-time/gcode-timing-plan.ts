import {
  buildProgramTimeline,
  type ProgramTimeline,
  type ProgramTimelineResult,
} from './program-timeline';
import { blockElapsedTimeAtDistance } from '../motion-planner';
import type { MotionLimits } from './motion-limits';

export type GcodeTimingPlan = ProgramTimeline;

export type GcodeTimingPlanResult =
  | { readonly kind: 'ok'; readonly plan: GcodeTimingPlan }
  | Exclude<ProgramTimelineResult, { readonly kind: 'ok' }>;

export type PlannedProgramProgress = {
  readonly motionSeconds: number;
  readonly dwellSeconds: number;
  readonly totalSeconds: number;
};

type InitialPosition = { readonly x: number; readonly y: number; readonly z: number };

export type GcodeTimingPlanOptions = {
  readonly maxSegments?: number;
};

const EMPTY_PROGRESS: PlannedProgramProgress = {
  motionSeconds: 0,
  dwellSeconds: 0,
  totalSeconds: 0,
};

/** Builds the execution clock from the exact G-code handed to the controller. */
export function buildGcodeTimingPlan(
  gcode: string,
  limits: MotionLimits,
  initialPosition?: InitialPosition,
  options: GcodeTimingPlanOptions = {},
): GcodeTimingPlanResult {
  const result = buildProgramTimeline(gcode, limits, {
    ...(initialPosition === undefined ? {} : { initialPositionMm: initialPosition }),
    ...options,
  });
  return result.kind === 'ok' ? { kind: 'ok', plan: result.timeline } : result;
}

/** Maps controller-confirmed route distance onto the program's planned clocks. */
export function plannedProgressAtRoute(
  plan: GcodeTimingPlan,
  routeMm: number,
): PlannedProgramProgress {
  const index = segmentIndexAtRoute(plan, routeMm);
  if (index < 0) return EMPTY_PROGRESS;
  const routeStart = plan.routeStartMm[index] ?? 0;
  const routeEnd = plan.routeEndMm[index] ?? routeStart;
  const fraction = routeFraction(routeMm, routeStart, routeEnd);
  const motionStart = plan.plannedMotionStartSeconds[index] ?? 0;
  const motionEnd = plan.plannedMotionEndSeconds[index] ?? motionStart;
  const totalStart = plan.plannedStartSeconds[index] ?? motionStart;
  const dwellSeconds = Math.max(0, totalStart - motionStart);
  const segmentDistance = plan.segmentDistanceMm[index] ?? Math.max(0, routeEnd - routeStart);
  const elapsedInSegment = blockElapsedTimeAtDistance(
    {
      distance: segmentDistance,
      targetVelocity: plan.segmentTargetVelocityMmPerSec[index] ?? 0,
    },
    plan.segmentEntryVelocityMmPerSec[index] ?? 0,
    plan.segmentExitVelocityMmPerSec[index] ?? 0,
    plan.accelMmPerSec2,
    segmentDistance * fraction,
  );
  const motionSeconds =
    motionStart + Math.min(Math.max(0, motionEnd - motionStart), elapsedInSegment);
  return { motionSeconds, dwellSeconds, totalSeconds: motionSeconds + dwellSeconds };
}

/** Maps an acknowledged-line count to a projection ceiling, not physical progress. */
export function plannedProgressAtSendableLine(
  plan: GcodeTimingPlan,
  completedCount: number,
): PlannedProgramProgress {
  if (completedCount <= 0 || plan.sendableLineEndSeconds.length === 0) return EMPTY_PROGRESS;
  const index = Math.min(
    Math.max(0, Math.floor(completedCount) - 1),
    plan.sendableLineEndSeconds.length - 1,
  );
  return {
    motionSeconds: plan.sendableLineMotionEndSeconds[index] ?? 0,
    dwellSeconds: plan.sendableLineDwellEndSeconds[index] ?? 0,
    totalSeconds: plan.sendableLineEndSeconds[index] ?? 0,
  };
}

/** Backward-compatible total planned time at a confirmed route distance. */
export function plannedSecondsAtRoute(plan: GcodeTimingPlan, routeMm: number): number {
  return plannedProgressAtRoute(plan, routeMm).totalSeconds;
}

function segmentIndexAtRoute(plan: GcodeTimingPlan, routeMm: number): number {
  if (routeMm <= 0 || plan.routeEndMm.length === 0) return -1;
  const boundedRoute = Math.min(routeMm, plan.totalRouteMm);
  let low = 0;
  let high = plan.routeEndMm.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((plan.routeEndMm[middle] ?? 0) < boundedRoute) low = middle + 1;
    else high = middle;
  }
  return low;
}

function routeFraction(routeMm: number, startMm: number, endMm: number): number {
  const span = endMm - startMm;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (routeMm - startMm) / span));
}
