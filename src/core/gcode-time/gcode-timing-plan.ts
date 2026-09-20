import {
  buildProgramTimeline,
  type ProgramTimeline,
  type ProgramTimelineResult,
} from './program-timeline';
import { blockElapsedTimeAtDistance } from '../motion-planner';
import type { MotionLimits } from './motion-limits';
import type { ProgramTimingOptions } from './program-timing-options';

export type GcodeTimingPlan = ProgramTimeline;

export type GcodeTimingPlanResult =
  | { readonly kind: 'ok'; readonly plan: GcodeTimingPlan }
  | Exclude<ProgramTimelineResult, { readonly kind: 'ok' }>;

export type PlannedProgramProgress = {
  readonly motionSeconds: number;
  readonly dwellSeconds: number;
  readonly totalSeconds: number;
  readonly transportSeconds?: number;
};

type InitialPosition = { readonly x: number; readonly y: number; readonly z: number };

export type GcodeTimingPlanOptions = ProgramTimingOptions & {
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
  const line = plan.segmentRawLine[index] ?? 0;
  const dwellSeconds = line === 0 ? 0 : (plan.rawLineDwellEndSeconds[line - 1] ?? 0);
  const transportSeconds = plan.rawLineTransportEndSeconds[line] ?? 0;
  const elapsedInSegment = segmentElapsedTime(plan, index, fraction);
  const motionSeconds =
    motionStart + Math.min(Math.max(0, motionEnd - motionStart), elapsedInSegment);
  return {
    motionSeconds,
    dwellSeconds,
    ...(transportSeconds > 0 ? { transportSeconds } : {}),
    totalSeconds: motionSeconds + dwellSeconds + transportSeconds,
  };
}

function segmentElapsedTime(plan: GcodeTimingPlan, index: number, fraction: number): number {
  const segmentDistance = plan.segmentDistanceMm[index] ?? 0;
  const elapsedInSegment = blockElapsedTimeAtDistance({
    block: {
      distance: segmentDistance,
      targetVelocity: plan.segmentTargetVelocityMmPerSec[index] ?? 0,
    },
    entryVelocity: plan.segmentEntryVelocityMmPerSec[index] ?? 0,
    exitVelocity: plan.segmentExitVelocityMmPerSec[index] ?? 0,
    acceleration: plan.accelMmPerSec2,
    distance: segmentDistance * fraction,
  });
  return elapsedInSegment * (plan.segmentTimeScale[index] ?? 1);
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
    ...(plan.transportSeconds > 0
      ? { transportSeconds: plan.sendableLineTransportEndSeconds[index] ?? 0 }
      : {}),
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
