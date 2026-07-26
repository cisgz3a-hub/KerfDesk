import {
  plannedProgressAtRoute,
  type GcodeTimingPlan,
  type GcodeTimingPlanResult,
  type PlannedProgramProgress,
} from '../../core/gcode-time';
import { assertNever } from '../../core/scene';

const MINIMUM_PLANNED_MOTION_SAMPLE_SECONDS = 1;
const ROUTE_PROGRESS_EPSILON_MM = 0.001;
const PACING_HISTORY_WEIGHT = 0.75;
const PACING_SAMPLE_WEIGHT = 1 - PACING_HISTORY_WEIGHT;
const MINIMUM_MOTION_PACE = 0.1;
const MAXIMUM_MOTION_PACE = 10;

type TrustedTimingSample = {
  readonly atMs: number;
  readonly routeMm: number;
  readonly progress: PlannedProgramProgress;
};

type MotionPaceSample = {
  readonly previous: TrustedTimingSample;
  readonly progress: PlannedProgramProgress;
  readonly routeMm: number;
  readonly atMs: number;
};

type PlannedTimingState = {
  readonly plan: GcodeTimingPlan;
  /** Prediction frozen at `updatedAtMs`. Only confirmed running consumes wall time. */
  readonly remainingSecondsAtUpdate: number;
  /** Observed wall time per planned motion second. Deterministic dwells stay unscaled. */
  readonly motionPace: number;
  readonly updatedAtMs: number;
  readonly lastTrustedSample: TrustedTimingSample | null;
};

export type LiveJobTiming =
  | ({ readonly kind: 'estimating' } & PlannedTimingState)
  | ({ readonly kind: 'running' } & PlannedTimingState)
  | ({ readonly kind: 'paused' } & PlannedTimingState)
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'finishing' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type LiveJobTimeDisplay =
  | { readonly kind: 'estimating'; readonly remainingSeconds: number }
  | { readonly kind: 'running'; readonly remainingSeconds: number }
  | { readonly kind: 'paused'; readonly remainingSeconds: number }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'finishing' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export function startLiveJobTiming(
  result: GcodeTimingPlanResult | undefined,
  now: number,
): LiveJobTiming {
  if (result === undefined) {
    return {
      kind: 'unavailable',
      reason: 'exact emitted-program timing was not prepared',
    };
  }
  if (result.kind !== 'ok') return { kind: 'unavailable', reason: result.reason };
  return {
    kind: 'estimating',
    plan: result.plan,
    remainingSecondsAtUpdate: result.plan.totalSeconds,
    motionPace: 1,
    updatedAtMs: now,
    lastTrustedSample: null,
  };
}

/** Marks active controller execution without claiming route-confirmed progress. */
export function runLiveJobTiming(timing: LiveJobTiming, now: number): LiveJobTiming {
  if (!hasPlan(timing)) return timing;
  return {
    ...timing,
    kind: 'running',
    remainingSecondsAtUpdate: remainingSecondsAt(timing, now),
    updatedAtMs: now,
    ...(timing.kind === 'paused' ? { lastTrustedSample: null } : {}),
  };
}

/**
 * Corrects the motion-only pace from a fresh, same-session, route-reconciled
 * controller position. Stream acknowledgements are intentionally absent.
 */
export function observeTrustedLiveJobProgress(
  timing: LiveJobTiming,
  routeMm: number,
  now: number,
): LiveJobTiming {
  const running = runLiveJobTiming(timing, now);
  if (!hasPlan(running) || running.kind !== 'running') return running;
  const boundedRoute = Math.max(0, Math.min(routeMm, running.plan.totalRouteMm));
  const progress = plannedProgressAtRoute(running.plan, boundedRoute);
  const previous = running.lastTrustedSample;
  if (previous !== null && boundedRoute <= previous.routeMm + ROUTE_PROGRESS_EPSILON_MM) {
    return running;
  }
  const motionPace =
    previous === null
      ? running.motionPace
      : calibratedMotionPace(running.motionPace, {
          previous,
          progress,
          routeMm: boundedRoute,
          atMs: now,
        });
  const shouldRetainCalibrationAnchor =
    previous !== null &&
    progress.motionSeconds - previous.progress.motionSeconds <
      MINIMUM_PLANNED_MOTION_SAMPLE_SECONDS;
  return {
    ...running,
    remainingSecondsAtUpdate: predictedRemaining(running.plan, progress, motionPace),
    motionPace,
    updatedAtMs: now,
    lastTrustedSample: shouldRetainCalibrationAnchor
      ? previous
      : { atMs: now, routeMm: boundedRoute, progress },
  };
}

export function pauseLiveJobTiming(timing: LiveJobTiming, now: number): LiveJobTiming {
  if (!hasPlan(timing)) return timing;
  return {
    ...timing,
    kind: 'paused',
    remainingSecondsAtUpdate: remainingSecondsAt(timing, now),
    updatedAtMs: now,
    lastTrustedSample: null,
  };
}

export function disconnectLiveJobTiming(timing: LiveJobTiming): LiveJobTiming {
  return timing.kind === 'complete' ? timing : { kind: 'disconnected' };
}

export function finishLiveJobTiming(timing: LiveJobTiming): LiveJobTiming {
  if (
    timing.kind === 'complete' ||
    timing.kind === 'unavailable' ||
    timing.kind === 'disconnected'
  ) {
    return timing;
  }
  return { kind: 'finishing' };
}

export function completeLiveJobTiming(): LiveJobTiming {
  return { kind: 'complete' };
}

export function interruptLiveJobTiming(reason: string): LiveJobTiming {
  return { kind: 'unavailable', reason };
}

export function describeLiveJobTiming(timing: LiveJobTiming, now: number): LiveJobTimeDisplay {
  switch (timing.kind) {
    case 'estimating':
      return { kind: 'estimating', remainingSeconds: remainingSecondsAt(timing, now) };
    case 'running':
      return { kind: 'running', remainingSeconds: remainingSecondsAt(timing, now) };
    case 'paused':
      return { kind: 'paused', remainingSeconds: timing.remainingSecondsAtUpdate };
    case 'disconnected':
      return { kind: 'disconnected' };
    case 'finishing':
      return { kind: 'finishing' };
    case 'complete':
      return { kind: 'complete' };
    case 'unavailable':
      return timing;
    default:
      return assertNever(timing);
  }
}

function calibratedMotionPace(current: number, sample: MotionPaceSample): number {
  const { previous, progress, routeMm, atMs } = sample;
  if (routeMm <= previous.routeMm + ROUTE_PROGRESS_EPSILON_MM) return current;
  const plannedMotion = progress.motionSeconds - previous.progress.motionSeconds;
  if (plannedMotion < MINIMUM_PLANNED_MOTION_SAMPLE_SECONDS) return current;
  const plannedDwell = Math.max(0, progress.dwellSeconds - previous.progress.dwellSeconds);
  const observedWall = Math.max(0, atMs - previous.atMs) / 1000;
  const observedMotion = observedWall - plannedDwell;
  if (!Number.isFinite(observedMotion) || observedMotion <= 0) return current;
  const observedPace = clamp(
    observedMotion / plannedMotion,
    MINIMUM_MOTION_PACE,
    MAXIMUM_MOTION_PACE,
  );
  return current * PACING_HISTORY_WEIGHT + observedPace * PACING_SAMPLE_WEIGHT;
}

function predictedRemaining(
  plan: GcodeTimingPlan,
  progress: PlannedProgramProgress,
  motionPace: number,
): number {
  const remainingMotion = Math.max(0, plan.motionSeconds - progress.motionSeconds);
  const remainingDwell = Math.max(0, plan.dwellSeconds - progress.dwellSeconds);
  return remainingMotion * motionPace + remainingDwell;
}

function remainingSecondsAt(timing: PlannedTimingState & { readonly kind: string }, now: number) {
  if (timing.kind !== 'running') return timing.remainingSecondsAtUpdate;
  return Math.max(
    0,
    timing.remainingSecondsAtUpdate - Math.max(0, now - timing.updatedAtMs) / 1000,
  );
}

function hasPlan(timing: LiveJobTiming): timing is LiveJobTiming & PlannedTimingState {
  return timing.kind === 'estimating' || timing.kind === 'running' || timing.kind === 'paused';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
