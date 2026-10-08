// laser-error-line — handles controller rejection lines (error:N / Resend)
// for the job stream. Split from laser-line-handler when the untracked-ack
// attribution pushed that file past the 400-line cap.

import { markErrored, wipeInFlight, type StreamerState } from '../../core/controllers/grbl';
import { isGrblFamilyDriver, runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import { frameProofReset } from './laser-session-reset';
import { driverQuickStops, noResetStopLines, quickStopPatch } from './laser-quick-stop';
import { armResetCleanup, resetCleanupLines } from './laser-reset-cleanup';
import {
  controllerErrorNotice,
  controllerHaltedNotice,
  skippedCommandNotice,
  type ControllerErrorContext,
  type LaserSafetyNotice,
  type SkippedCommand,
} from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { requalifyAfterHaltingReset } from './laser-controller-qualification';
import { clearCncLiveCaps } from './detected-settings-action';
import { streamResetRecord } from './job-stop-request';
import { advanceStream } from './laser-stream-ack';
import { noteRefusedLine } from './laser-parser-rearm';
import type { AckSettlement, GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';

/** What the controller answered instead of accepting a line. */
export type ControllerRejection = {
  readonly code: number | null;
  readonly raw: string | undefined;
  /** The firmware halted itself and needs a reset or power cycle (MA-10). */
  readonly halted?: boolean;
  /** Marlin skipped the line as an unknown command (MA-12). */
  readonly skipped?: SkippedCommand;
};

export function handleErrorLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  rejection: ControllerRejection,
  ackSettlement: AckSettlement,
  ownedCommandLine?: string,
): void {
  const state = get();
  // An error owed to an untracked write (console typo, rejected origin
  // command) is not a stream event: surface it, but leave the streamer's
  // accounting and the auto-stop path alone.
  const rejectedLine =
    ackSettlement.owner === 'stream'
      ? state.streamer?.inFlight[0]?.line.trim()
      : ownedCommandLine?.trim();
  const rejectedMotionId =
    ackSettlement.owner === 'untracked' ? ackSettlement.motionOperationId : null;
  const motionErrorPatch =
    rejectedMotionId !== null && state.motionOperation?.operationId === rejectedMotionId
      ? { motionOperation: { ...state.motionOperation, cancelRequested: true } }
      : {};
  set({
    lastError: rejection.code,
    ...frameProofReset(),
    ...errorNoticePatch(state, rejection, rejectedLine),
    ...plannedRejectionResetPatch(state, refs, rejection, ackSettlement),
    ...motionErrorPatch,
  });
  if (ackSettlement.owner === 'untracked') {
    // grblHAL latches the error for every later G-code line (HF-7).
    noteRefusedLine(refs);
    return;
  }
  // A halted controller runs nothing more, so no stop line is written to it.
  advanceStream(set, get, refs, safeWrite, 'error');
  if (rejection.halted !== true) {
    requestRealtimeStopAfterStreamError(set, get, refs, state, safeWrite);
  }
}

// Checksum-mode retransmission is not implemented (ADR-094 v1): the sender
// and firmware are desynced, so a Resend is a fatal stream error rather than
// a replay — replaying motion lines out of order could move a live laser.
export function handleResendLine(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
  requestedLine: number,
): void {
  const current = get();
  set({
    ...plannedStreamResetPatch(current, refs),
    frameVerification: null,
    framedRun: null,
    frameTrace: null,
    // Retransmission is deliberately unsupported: once firmware reports a
    // protocol desynchronization, an in-flight Frame/Jog can no longer prove
    // that every intended motion line executed exactly once. Keep its FIFO
    // reservation quarantined (Resend is not a terminal ack), but make the
    // owned candidate permanently ineligible for further dispatch/completion.
    ...(current.motionOperation === null
      ? {}
      : { motionOperation: { ...current.motionOperation, cancelRequested: true } }),
    ...errorNoticePatch(
      current,
      {
        code: null,
        raw: `Resend:${requestedLine} — line-number retransmission is not supported`,
      },
      undefined,
    ),
  });
  // Resend is not a terminal acknowledgement; retain its exact owed line.
  set((state) =>
    state.streamer === null || isStoppedStreamErrorEcho(state.streamer)
      ? {}
      : { streamer: markErrored(state.streamer), ...liveCanvasLifecyclePatch(state, 'errored') },
  );
  requestRealtimeStopAfterStreamError(set, get, refs, current, safeWrite);
}

// Abort (user or auto-abort-after-error) sends realtime reset plus a queued
// beam-off line; the locked controller bounces that line with error:9. Those
// echoes of a shutdown the app itself requested must not raise a fresh "the
// laser may have fired out of place" banner — on a stream that is already
// terminal the error is expected, and an existing notice is the root cause
// the operator still needs to read (first notice wins, as in the settle
// failure path).
// A halted controller (Marlin kill()) is never an echo of a requested stop, and
// what it needs — its reset button or a power cycle — overrides earlier advice.
function errorNoticePatch(
  state: LaserState,
  rejection: ControllerRejection,
  rejectedLine: string | undefined,
): Partial<Pick<LaserState, 'safetyNotice'>> {
  if (rejection.halted === true) {
    return { safetyNotice: controllerHaltedNotice(rejection.raw ?? 'kill() called') };
  }
  if (isStoppedStreamErrorEcho(state.streamer)) return {};
  const previous =
    state.safetyNotice?.kind === 'cnc-transition-unconfirmed' ? null : state.safetyNotice;
  return { safetyNotice: previous ?? rejectionNotice(state, rejection, rejectedLine) };
}

function rejectionNotice(
  state: LaserState,
  rejection: ControllerRejection,
  rejectedLine: string | undefined,
): LaserSafetyNotice {
  if (rejection.skipped !== undefined && rejectedLine !== undefined) {
    return skippedCommandNotice(rejection.skipped, rejectedLine);
  }
  return controllerErrorNotice(
    rejection.code,
    controllerErrorContext(state),
    rejection.raw,
    rejectedLine,
  );
}

function isStoppedStreamErrorEcho(streamer: StreamerState | null): boolean {
  return streamer !== null && ['cancelled', 'errored', 'disconnected'].includes(streamer.status);
}

function plannedRejectionResetPatch(
  state: LaserState,
  refs: HandlerRefs,
  rejection: ControllerRejection,
  ackSettlement: AckSettlement,
): Partial<Pick<LaserState, 'streamReset'>> {
  return ackSettlement.owner === 'stream' && rejection.halted !== true
    ? plannedStreamResetPatch(state, refs)
    : {};
}

function streamCanStillHaveBufferedMotion(streamer: StreamerState | null): boolean {
  return (
    streamer !== null && ['streaming', 'paused', 'done', 'tool-change'].includes(streamer.status)
  );
}

function plannedStreamResetPatch(
  state: LaserState,
  refs: HandlerRefs,
): Partial<Pick<LaserState, 'streamReset'>> {
  // Checkpoint subscribers archive the first errored observation. Record this
  // planned reset before publishing that terminal state, while the pre-error
  // stream and motion still describe whether position may be lost.
  return refs.driver.realtime.softReset !== null && streamCanStillHaveBufferedMotion(state.streamer)
    ? { streamReset: streamResetRecord(state) }
    : {};
}

function requestRealtimeStopAfterStreamError(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  state: LaserState,
  safeWrite: SafeWriteFn,
): void {
  if (!streamCanStillHaveBufferedMotion(state.streamer)) return;
  const driver = refs.driver;
  const softReset = driver.realtime.softReset;
  if (softReset === null) {
    // No reset byte (Marlin): the controller's quickstop lines (M107, M410,
    // M5 I, and M9 when air may be on) go out at once, as Abort sends them;
    // their acks queue behind the in-flight job lines (MA-7).
    const lines = noResetStopLines(driver, state);
    if (driverQuickStops(driver)) set((current) => quickStopPatch(current));
    void (async () => {
      for (const line of lines) await safeWrite(line, 'stop', 'system');
    })().catch(() => undefined);
    return;
  }
  if (isGrblFamilyDriver(driver)) {
    set({ streamReset: streamResetRecord(state) });
    void runGrblDisconnectTransaction(set, refs, safeWrite, {
      retainConnection: true,
      action: 'stop',
      keepErroredStreamer: true,
      cleanupLines: resetCleanupLines(driver),
    }).catch(() => undefined);
    return;
  }
  clearCncLiveCaps();
  // The reset kills the steppers if the controller is still running the
  // moves it buffered before the rejection (ADR-215 Amendment 1).
  set((state) => ({
    ...invalidateControllerSessionEvidence(state),
    streamReset: streamResetRecord(state),
  }));
  requalifyAfterHaltingReset(set, get, refs, driver.capabilities);
  // Arm before the realtime write, exactly like operator Abort. Web Serial can
  // reject its promise after the reset byte reached the controller and a boot
  // banner can arrive immediately; pre-arming preserves that evidence race and
  // guarantees the cleanup includes M5 even when stopLaserLines is M9-only.
  armResetCleanup(
    refs,
    (line, action) => safeWrite(line, action, 'system'),
    resetCleanupLines(driver),
  );
  void safeWrite(softReset, 'stop', 'system')
    .then(() => {
      // The sent reset wiped the firmware's RX buffer: the errored stream's
      // remaining in-flight lines will never be acked, so drop them or the
      // cleanup acks get claimed by the dead stream (audit F1). Status stays
      // 'errored' — Abort remains mounted. The beam-off cleanup itself is
      // deferred until the boot banner (audit F2), like stopJob's.
      set((s) => ({ streamer: s.streamer === null ? null : wipeInFlight(s.streamer) }));
    })
    .catch(() => undefined);
}

function controllerErrorContext(state: LaserState): ControllerErrorContext {
  if (state.streamer !== null) return 'job';
  if (state.motionOperation?.kind === 'frame') return 'frame';
  if (state.motionOperation?.kind === 'jog') return 'jog';
  return 'command';
}
