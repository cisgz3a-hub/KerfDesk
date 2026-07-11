// laser-status-line — maps an inbound controller status report into
// LaserState. Split from laser-line-handler when the untracked-ack
// attribution pushed that file past the 400-line cap.

import {
  cancel as cancelStreamer,
  wipeInFlight,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import {
  cancelControllerLifecycleRefs,
  observeControllerIdleWait,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import {
  markMotionOperationDispatched,
  observeMotionStatus,
  takeNextFrameJogLine,
} from './laser-motion-operation';
import type { LaserState } from './laser-store';
import type { SafeWriteFn, SetFn } from './laser-line-shared';
import { hasCustomOrigin } from './origin-actions';

export function handleStatusLine(
  set: SetFn,
  get: () => LaserState,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
  report: StatusReport,
): void {
  const state = get();
  const operation = state.motionOperation;
  const streamer = state.streamer;
  if (report.state === 'Alarm') {
    set({
      statusReport: report,
      wcoCache: null,
      ovCache: null,
      ...originUnknownAfterControllerReset(get()),
      motionOperation: null,
      controllerOperation: null,
      frameVerification: null,
      homingState: 'unknown',
      pendingUntrackedAcks: 0,
      // A status-only Alarm (the ALARM:N line may have been consumed by a
      // pending command) must still terminate an active stream — a paused
      // stream would otherwise keep Resume mounted against a locked
      // controller.
      ...cancelActiveStreamerPatch(streamer),
    });
    cancelControllerLifecycleRefs(refs, 'Controller entered Alarm.');
    return;
  }
  if (report.state === 'Sleep') {
    set({
      statusReport: report,
      alarmCode: null,
      wcoCache: null,
      ovCache: null,
      ...originUnknownAfterControllerReset(get()),
      motionOperation: null,
      controllerOperation: null,
      frameVerification: null,
      homingState: 'unknown',
      pendingUntrackedAcks: 0,
    });
    cancelControllerLifecycleRefs(refs, 'Controller entered Sleep.');
    return;
  }
  const observedOperation = observeMotionStatus(operation, report.state);
  const queuedFrameDispatch =
    operation !== null && observedOperation === null ? takeNextFrameJogLine(operation) : null;
  const nextOperation = queuedFrameDispatch?.operation ?? observedOperation;
  const operationPatch = operation === nextOperation ? {} : { motionOperation: nextOperation };
  // Release the job lock once GRBL settles to Idle for BOTH a clean finish
  // ('done') and a rejected line ('errored'). Idle means physical motion has
  // stopped, so it is as safe to clear here as the 'done' case. Without the
  // 'errored' arm a GRBL error:N left the streamer terminal-but-non-null
  // forever, so isActiveJob stayed true and every setup/jog/console command —
  // plus the clear-canvas guard — was blocked until a reconnect. The
  // controller-error safetyNotice lives in separate state and survives.
  // A 'done' streamer normally belongs to the post-job settle, which releases
  // it itself — but when the settle failed or never started, no operation owns
  // the release and the same Idle-means-motion-stopped reasoning applies.
  const jobOverAtIdle = shouldReleaseStreamerAtIdle(streamer, state.controllerOperation, report);
  const completedStreamerPatch = jobOverAtIdle ? { streamer: null } : {};
  // A fresh Idle observed while holding at a tool change, with the pre-M0 tail
  // drained, means the retract/park motion has stopped — the setup gate and
  // Continue may unlock (Codex audit P1). Latches; only tool-change entry resets.
  const toolChangeReadyPatch =
    report.state === 'Idle' && streamer?.status === 'tool-change' && streamer.inFlight.length === 0
      ? { toolChangeIdleSeen: true }
      : {};

  set({
    ...statusPositionPatch(report, state.workOriginSource),
    ...operationPatch,
    ...completedStreamerPatch,
    ...toolChangeReadyPatch,
  });
  observeControllerIdleWait(set, refs, report);
  if (queuedFrameDispatch !== null)
    dispatchQueuedFrameLine(set, safeWrite, queuedFrameDispatch.line);
}

// After an alarm or reset the controller has dropped G92; a persistent G54
// origin may survive but is unverified until the next WCO frame.
export function originUnknownAfterControllerReset(
  state: LaserState,
): Pick<LaserState, 'workOriginActive' | 'workOriginSource' | 'workZZeroKnown'> {
  // A controller reset/alarm/reboot voids the bit-to-stock Z relationship
  // regardless of what happens to the XY origin (Codex audit P1).
  if (state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown') {
    return { workOriginActive: true, workOriginSource: 'unknown', workZZeroKnown: false };
  }
  return { workOriginActive: false, workOriginSource: 'none', workZZeroKnown: false };
}

function cancelActiveStreamerPatch(
  streamer: StreamerState | null,
): Partial<Pick<LaserState, 'streamer'>> {
  if (streamer === null) return {};
  // 'tool-change' is an active hold (M0 queued, pre-M0 motion may be draining):
  // an Alarm there wiped the firmware buffer just as during streaming/paused, so
  // cancel it too (Codex audit: status list not updated when tool-change landed).
  if (!['idle', 'streaming', 'paused', 'tool-change'].includes(streamer.status)) return {};
  // Alarm = the firmware wiped its buffer; in-flight lines will never be
  // acked, so drop them from the accounting too (audit F1).
  return { streamer: wipeInFlight(cancelStreamer(streamer)) };
}

function shouldReleaseStreamerAtIdle(
  streamer: StreamerState | null,
  controllerOperation: LaserState['controllerOperation'],
  report: StatusReport,
): boolean {
  if (streamer === null || report.state !== 'Idle') return false;
  if (streamer.status === 'errored') return true;
  return streamer.status === 'done' && controllerOperation === null;
}

function statusPositionPatch(
  report: StatusReport,
  originSource: LaserState['workOriginSource'],
): Pick<LaserState, 'statusReport'> &
  Partial<Pick<LaserState, 'wcoCache' | 'ovCache' | 'workOriginActive' | 'workOriginSource'>> {
  // Ov: is reported on the same intermittent cadence as WCO — cache the
  // last-seen values so the overrides readout doesn't flicker (ADR-103 G3).
  const ovPatch = report.ov === null || report.ov === undefined ? {} : { ovCache: report.ov };
  if (report.wco === null) return { statusReport: report, ...ovPatch };
  const active = hasCustomOrigin(report.wco);
  return {
    statusReport: report,
    ...ovPatch,
    wcoCache: report.wco,
    workOriginActive: active,
    workOriginSource: active ? knownOrUnknownOriginSource(originSource) : 'none',
  };
}

function knownOrUnknownOriginSource(
  source: LaserState['workOriginSource'],
): LaserState['workOriginSource'] {
  return source === 'none' ? 'unknown' : source;
}

function dispatchQueuedFrameLine(set: SetFn, safeWrite: SafeWriteFn, line: string): void {
  void safeWrite(line, 'frame')
    .then(() => {
      set((s) => ({
        motionOperation: markMotionOperationDispatched(s.motionOperation, 'frame'),
      }));
    })
    .catch(() => {
      set({ motionOperation: null, frameVerification: null });
    });
}
