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
import { hasCustomXyOrigin } from './origin-actions';

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
  if (isInvalidatingStatusState(report.state)) {
    handleInvalidatingStatus(set, refs, state, report, streamer);
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

  const positionInvalidated = report.mpgActive === true && state.mpgActive !== true;
  const nextSequence = state.statusSequence + 1;
  set({
    ...statusPositionPatch(report, state.workOriginSource, state.accessoryCache),
    statusSequence: nextSequence,
    statusObservation: positionInvalidated
      ? null
      : {
          sessionEpoch: state.controllerSessionEpoch,
          positionEpoch: state.trustedPositionEpoch ?? 0,
          sequence: nextSequence,
          observedAt: Date.now(),
        },
    ...mpgOwnershipPatch(report, state),
    ...operationPatch,
    ...completedStreamerPatch,
    ...freshToolChangeIdlePatch(streamer, report),
  });
  observeControllerIdleWait(set, refs, report);
  if (queuedFrameDispatch !== null)
    dispatchQueuedFrameLine(set, safeWrite, queuedFrameDispatch.line);
}

function isInvalidatingStatusState(state: string): boolean {
  return state === 'Alarm' || state === 'Sleep';
}

function handleInvalidatingStatus(
  set: SetFn,
  refs: ControllerLifecycleRefs,
  state: LaserState,
  report: StatusReport,
  streamer: StreamerState | null,
): void {
  const alarm = report.state === 'Alarm';
  advanceWriteEpoch(refs);
  set({
    statusReport: report,
    statusSequence: state.statusSequence + 1,
    statusObservation: null,
    ...(alarm ? cancelActiveStreamerPatch(streamer) : { alarmCode: null }),
    wcoCache: null,
    ovCache: null,
    accessoryCache: null,
    mpgActive: null,
    ...originUnknownAfterControllerReset(state),
    motionOperation: null,
    controllerOperation: null,
    fireActive: false,
    frameVerification: null,
    homingState: 'unknown',
    homingProof: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
  });
  cancelControllerLifecycleRefs(refs, `Controller entered ${alarm ? 'Alarm' : 'Sleep'}.`);
}

function advanceWriteEpoch(refs: ControllerLifecycleRefs): void {
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
}

// A fresh Idle observed while holding at a tool change, with the pre-M0 tail
// drained, means the retract/park motion has stopped — the setup gate and
// Continue may unlock (Codex audit P1). Latches; only tool-change entry resets.
function freshToolChangeIdlePatch(
  streamer: StreamerState | null,
  report: StatusReport,
): Partial<Pick<LaserState, 'toolChangeIdleSeen'>> {
  const drainedIdleHold =
    report.state === 'Idle' && streamer?.status === 'tool-change' && streamer.inFlight.length === 0;
  return drainedIdleHold ? { toolChangeIdleSeen: true } : {};
}

// After an alarm or reset the controller has dropped G92; a persistent G54
// origin may survive but is unverified until the next WCO frame.
export function originUnknownAfterControllerReset(
  state: LaserState,
): Pick<
  LaserState,
  'workOriginActive' | 'workOriginSource' | 'workZZeroEvidence' | 'workZReferenceEpoch'
> {
  // A controller reset/alarm/reboot voids the bit-to-stock Z relationship
  // regardless of what happens to the XY origin (Codex audit P1).
  if (state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown') {
    return {
      workOriginActive: true,
      workOriginSource: 'unknown',
      workZZeroEvidence: null,
      workZReferenceEpoch: state.workZReferenceEpoch + 1,
    };
  }
  return {
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
  };
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
  previousAccessories: LaserState['accessoryCache'],
): Pick<LaserState, 'statusReport'> &
  Partial<
    Pick<
      LaserState,
      'wcoCache' | 'ovCache' | 'accessoryCache' | 'workOriginActive' | 'workOriginSource'
    >
  > {
  // Ov: is reported on the same intermittent cadence as WCO — cache the
  // last-seen values so the overrides readout doesn't flicker (ADR-103 G3).
  const ovPatch = report.ov === null || report.ov === undefined ? {} : { ovCache: report.ov };
  // A: is intermittent with Ov:. Preserve the last state on frames carrying
  // neither field; the parser turns Ov-without-A into a known all-off value.
  const accessoryPatch =
    report.accessories === null || report.accessories === undefined
      ? {}
      : {
          accessoryCache: {
            ...report.accessories,
            ...(previousAccessories?.secondarySpindlePresent === true
              ? { secondarySpindlePresent: true }
              : {}),
            ...exceptionalAccessoryLatch(previousAccessories, report.accessoryReportPresent),
          },
        };
  if (report.wco === null) return { statusReport: report, ...ovPatch, ...accessoryPatch };
  const active = hasCustomXyOrigin(report.wco);
  return {
    statusReport: report,
    ...ovPatch,
    ...accessoryPatch,
    wcoCache: report.wco,
    workOriginActive: active,
    workOriginSource: active ? knownOrUnknownOriginSource(originSource) : 'none',
  };
}

function mpgOwnershipPatch(
  report: StatusReport,
  state: LaserState,
): Partial<
  Pick<
    LaserState,
    | 'mpgActive'
    | 'trustedPositionEpoch'
    | 'workZReferenceEpoch'
    | 'workZZeroEvidence'
    | 'frameVerification'
    | 'statusObservation'
    | 'homingState'
    | 'homingProof'
  >
> {
  if (report.mpgActive === null || report.mpgActive === undefined) return {};
  if (!report.mpgActive || state.mpgActive === true) return { mpgActive: report.mpgActive };
  return {
    mpgActive: true,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    statusObservation: null,
    homingState: 'unknown',
    homingProof: null,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    workZZeroEvidence: null,
    frameVerification: null,
  };
}

function exceptionalAccessoryLatch(
  previous: LaserState['accessoryCache'],
  explicitAccessoryReport: boolean | undefined,
): Partial<NonNullable<LaserState['accessoryCache']>> {
  if (explicitAccessoryReport === true) return {};
  return {
    ...(previous?.spindleEncoderFault === true ? { spindleEncoderFault: true } : {}),
    ...(previous?.toolChangePending === true ? { toolChangePending: true } : {}),
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
