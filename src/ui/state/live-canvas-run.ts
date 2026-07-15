import {
  reconcileReportedPosition,
  type RouteReconciliationState,
} from '../../core/job/live-route-reconciliation';
import type { StatusReport, StreamerState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
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
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  const run = state.liveCanvasRun ?? null;
  if (run === null) return {};
  const lifecycle = lifecycleFor(streamer, report, run.lifecycle);
  const reportInches = state.controllerSettings?.reportInches === true;
  const reportedHead = reportedWorkPositionMm(
    {
      statusReport: report,
      wcoCache: state.wcoCache,
      workOriginActive: state.workOriginActive,
    },
    reportInches,
  );
  return { liveCanvasRun: updatedRun(state, run, report, streamer, lifecycle, reportedHead) };
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
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  return plan === undefined ? {} : { liveCanvasRun: startLiveCanvasRun(plan) };
}

export function liveCanvasLifecyclePatch(
  state: LaserState,
  lifecycle: Exclude<LiveCanvasLifecycle, 'finished'>,
): Partial<Pick<LaserState, 'liveCanvasRun'>> {
  const run = state.liveCanvasRun ?? null;
  if (run === null || run.lifecycle === 'finished') return {};
  return { liveCanvasRun: { ...run, lifecycle } };
}

function mayReconcile(
  run: LiveCanvasRun,
  streamer: StreamerState | null,
  report: StatusReport,
  state: LaserState,
): boolean {
  if (run.plan.capability !== 'realtime') return false;
  if (run.plan.positionEpoch !== (state.trustedPositionEpoch ?? 0)) return false;
  if (streamer === null || (streamer.status !== 'streaming' && streamer.status !== 'done')) {
    return false;
  }
  if (state.probeBusy || state.motionOperation !== null) return false;
  return report.state === 'Run' || report.state === 'Idle';
}

function lifecycleFor(
  streamer: StreamerState | null,
  report: StatusReport,
  current: LiveCanvasLifecycle,
): LiveCanvasLifecycle {
  return (
    controllerLifecycle(report, streamer) ??
    streamerLifecycle(streamer) ??
    resumedLifecycle(current, streamer)
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

function streamerLifecycle(streamer: StreamerState | null): LiveCanvasLifecycle | null {
  switch (streamer?.status) {
    case 'paused':
      return 'paused';
    case 'tool-change':
      return 'tool-change';
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

function resumedLifecycle(
  current: LiveCanvasLifecycle,
  streamer: StreamerState | null,
): LiveCanvasLifecycle {
  return current === 'paused' && streamer?.status === 'streaming' ? 'running' : current;
}

function completedRoute(run: LiveCanvasRun): RouteReconciliationState {
  return {
    confirmedRouteMm: run.plan.manifest.totalRouteMm,
    candidates: [],
    uncertain: false,
  };
}
