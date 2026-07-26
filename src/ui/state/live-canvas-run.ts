import {
  reconcileReportedPosition,
  type RouteReconciliationState,
} from '../../core/job/live-route-reconciliation';
import type { StatusReport, StreamerState } from '../../core/controllers/grbl';
import type { GcodeTimingPlanResult } from '../../core/gcode-time';
import { normalizeReportedFeedRateToMm } from '../../core/controllers/grbl/machine-envelope';
import type { LaserState } from './laser-store';
import {
  completeLiveCanvasRun,
  endStampFor,
  initialLiveCanvasTiming,
  liveCanvasLifecyclePatch,
  liveCanvasTimingForStatus,
} from './live-canvas-run-timing';
import {
  reportedWorkPositionMm,
  startLiveCanvasRun,
  type CanvasMotionPlan,
  type LiveCanvasLifecycle,
  type LiveCanvasRun,
} from './canvas-motion-plan';

export function liveCanvasStatusPatch(
  state: LaserState,
  report: StatusReport,
  streamer: StreamerState | null,
  now: number = Date.now(),
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  const run = state.liveCanvasRun ?? null;
  if (run === null) return {};
  const lifecycle = lifecycleFor(
    streamer,
    report,
    run.lifecycle,
    toolChangeIsPhysicallyHeld(state, streamer, report),
  );
  const reportInches = state.controllerSettings?.reportInches === true;
  const reportedHead = reportedWorkPositionMm(
    {
      statusReport: report,
      wcoCache: state.wcoCache,
      workOriginActive: state.workOriginActive,
    },
    reportInches,
  );
  // Feed and spindle are fresh scalar samples each frame, independent of route
  // reconciliation, so they override uniformly on top of the reconciled run;
  // the badge only surfaces them while the job is actually running. Spindle is
  // passed through unscaled — it is an RPM/power value, not a unit distance.
  const reportedFeedMmPerMin = normalizeReportedFeedRateToMm(report.feed, reportInches);
  const updated = updatedRun(state, run, report, streamer, lifecycle, reportedHead);
  const controllerExecutionConfirmed =
    report.state === 'Run' && mayReconcile(run, streamer, report, state);
  const timing = liveCanvasTimingForStatus(
    run,
    updated,
    mayTrustTimingProgress(state, run, updated, report, streamer, reportedHead),
    now,
    controllerExecutionConfirmed,
  );
  return {
    liveCanvasRun: {
      ...updated,
      reportedFeedMmPerMin,
      reportedSpindleRpm: report.spindle,
      endedAtMs: endStampFor(run, updated.lifecycle, now),
      ...(timing === undefined ? {} : { timing }),
    },
  };
}

function updatedRun(
  state: LaserState,
  run: LiveCanvasRun,
  report: StatusReport,
  streamer: StreamerState | null,
  lifecycle: LiveCanvasLifecycle,
  reportedHead: LiveCanvasRun['reportedHead'],
): LiveCanvasRun {
  if (lifecycle === 'finished') {
    return {
      ...run,
      reportedHead,
      lifecycle,
      controllerState: report.state,
      route: completedRoute(run),
      accuracyReason: run.plan.unavailableReason,
    };
  }
  if (!mayReconcile(run, streamer, report, state)) {
    return unreconciledRun(state, run, report, lifecycle);
  }
  if (reportedHead === null) {
    return {
      ...run,
      lifecycle,
      controllerState: report.state,
      accuracyReason: 'Controller position unavailable.',
    };
  }
  const executingLineNumber = report.executingLineNumber;
  const route = reconcileReportedPosition({
    manifest: run.plan.manifest,
    previous: run.route,
    reportedPosition: reportedHead,
    acceptedSendableLines: streamer?.completed ?? 0,
    ...(executingLineNumber === undefined ? {} : { executingLineNumber }),
  });
  return {
    ...run,
    // Keep the dot at the last route-reconciled position. The raw controller
    // sample is still represented by the uncertainty badge, but an off-route
    // or mixed-frame coordinate must not visually teleport the head.
    reportedHead: route.uncertain ? run.reportedHead : reportedHead,
    route,
    lifecycle,
    controllerState: report.state,
    accuracyReason: route.uncertain ? 'Route match uncertain; confirmed trail is frozen.' : null,
  };
}

function unreconciledRun(
  state: LaserState,
  run: LiveCanvasRun,
  report: StatusReport,
  lifecycle: LiveCanvasLifecycle,
): LiveCanvasRun {
  const positionReferenceChanged =
    run.plan.capability === 'realtime' &&
    run.plan.positionEpoch !== (state.trustedPositionEpoch ?? 0);
  return {
    ...run,
    // Pause, tool-change, probe/setup motion, and unavailable reconciliation
    // all freeze the displayed job head at its last trusted job position.
    reportedHead: run.reportedHead,
    lifecycle,
    controllerState: report.state,
    accuracyReason: positionReferenceChanged
      ? 'Position reference changed; confirmed trail is frozen.'
      : run.accuracyReason,
  };
}

export function liveCanvasStartPatch(
  plan: CanvasMotionPlan | undefined,
  now: number = Date.now(),
  jobTimingPlan?: GcodeTimingPlanResult,
  initialLifecycle: 'running' | 'tool-change' = 'running',
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  if (plan === undefined) return {};
  return {
    liveCanvasRun: {
      ...startLiveCanvasRun(plan, now),
      lifecycle: initialLifecycle,
      timing: initialLiveCanvasTiming(jobTimingPlan, now, initialLifecycle),
    },
  };
}

export function liveCanvasExecutionAcceptedPatch(
  state: LaserState,
  resumeFromPaused = false,
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  return lifecycleAcceptsExecution(state, resumeFromPaused) &&
    streamerMayBeExecuting(state) &&
    !controllerBlocksExecution(state)
    ? liveCanvasLifecyclePatch(state, 'running')
    : {};
}

function lifecycleAcceptsExecution(state: LaserState, resumeFromPaused: boolean): boolean {
  const lifecycle = state.liveCanvasRun?.lifecycle;
  return (
    lifecycle === 'running' ||
    lifecycle === 'tool-change' ||
    (resumeFromPaused && lifecycle === 'paused')
  );
}

function streamerMayBeExecuting(state: LaserState): boolean {
  const status = state.streamer?.status;
  if (status === 'streaming' || status === 'done') return true;
  return status === 'tool-change' && !state.toolChangeIdleSeen;
}

function controllerBlocksExecution(state: LaserState): boolean {
  const controllerState = state.statusReport?.state;
  return (
    controllerState === 'Hold' ||
    controllerState === 'Door' ||
    controllerState === 'Tool' ||
    controllerState === 'Alarm' ||
    controllerState === 'Sleep'
  );
}

export function liveCanvasStatusCompletionPatch(
  state: LaserState,
  report: StatusReport,
  streamer: StreamerState | null,
  completeAtIdle: boolean,
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  const livePatch = liveCanvasStatusPatch(state, report, streamer);
  if (
    !completeAtIdle ||
    streamer?.status !== 'done' ||
    state.liveCanvasRun?.plan.capability !== 'realtime'
  ) {
    return livePatch;
  }
  return {
    ...livePatch,
    liveCanvasRun: completeLiveCanvasRun(livePatch.liveCanvasRun ?? state.liveCanvasRun ?? null),
  };
}

export {
  completeLiveCanvasRun,
  liveCanvasFinishingPatch,
  liveCanvasLifecyclePatch,
  liveCanvasTimingUnavailablePatch,
} from './live-canvas-run-timing';

function mayTrustTimingProgress(
  state: LaserState,
  previous: LiveCanvasRun,
  updated: LiveCanvasRun,
  report: StatusReport,
  streamer: StreamerState | null,
  reportedHead: LiveCanvasRun['reportedHead'],
): boolean {
  return (
    updated.lifecycle === 'running' &&
    report.state === 'Run' &&
    (streamer?.status === 'streaming' ||
      streamer?.status === 'tool-change' ||
      streamer?.status === 'done') &&
    reportedHead !== null &&
    mayReconcile(previous, streamer, report, state) &&
    !updated.route.uncertain
  );
}

function mayReconcile(
  run: LiveCanvasRun,
  streamer: StreamerState | null,
  report: StatusReport,
  state: LaserState,
): boolean {
  if (run.plan.capability !== 'realtime') return false;
  if (run.plan.positionEpoch !== (state.trustedPositionEpoch ?? 0)) return false;
  if (report.mpgActive === true || state.mpgActive === true) return false;
  if (!streamerMayReconcile(streamer, state.toolChangeIdleSeen)) return false;
  if (state.probeBusy || state.motionOperation !== null) return false;
  return report.state === 'Run' || report.state === 'Idle';
}

function streamerMayReconcile(
  streamer: StreamerState | null,
  toolChangeIdleSeen: boolean,
): boolean {
  if (streamer === null) return false;
  if (!['streaming', 'tool-change', 'done'].includes(streamer.status)) return false;
  return streamer.status !== 'tool-change' || !toolChangeIdleSeen;
}

function lifecycleFor(
  streamer: StreamerState | null,
  report: StatusReport,
  current: LiveCanvasLifecycle,
  toolChangeIsHeld: boolean,
): LiveCanvasLifecycle {
  return (
    controllerLifecycle(report, streamer) ??
    streamerLifecycle(streamer, toolChangeIsHeld) ??
    resumedLifecycle(current, streamer, report)
  );
}

function controllerLifecycle(
  report: StatusReport,
  streamer: StreamerState | null,
): LiveCanvasLifecycle | null {
  if (report.state === 'Alarm') return 'errored';
  if (report.state === 'Hold' || report.state === 'Door') return 'paused';
  if (report.state === 'Tool') return 'tool-change';
  return report.state === 'Idle' && streamer?.status === 'done' ? 'finished' : null;
}

function streamerLifecycle(
  streamer: StreamerState | null,
  toolChangeIsHeld: boolean,
): LiveCanvasLifecycle | null {
  switch (streamer?.status) {
    case 'paused':
      return 'paused';
    case 'tool-change':
      return toolChangeIsHeld ? 'tool-change' : 'running';
    case 'cancelled':
      return 'stopped';
    case 'disconnected':
      return 'disconnected';
    case 'errored':
      return 'errored';
    case undefined:
    case 'idle':
    case 'done':
    case 'streaming':
      return null;
  }
}

function toolChangeIsPhysicallyHeld(
  state: LaserState,
  streamer: StreamerState | null,
  report: StatusReport,
): boolean {
  if (streamer?.status !== 'tool-change') return false;
  return state.toolChangeIdleSeen || (report.state === 'Idle' && streamer.inFlight.length === 0);
}

function resumedLifecycle(
  current: LiveCanvasLifecycle,
  streamer: StreamerState | null,
  report: StatusReport,
): LiveCanvasLifecycle {
  return current === 'paused' &&
    report.state === 'Run' &&
    (streamer?.status === 'streaming' || streamer?.status === 'done')
    ? 'running'
    : current;
}

function completedRoute(run: LiveCanvasRun): RouteReconciliationState {
  return {
    confirmedRouteMm: run.plan.manifest.totalRouteMm,
    candidates: [],
    uncertain: false,
  };
}
