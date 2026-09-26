// laser-job-stop — Abort. ABORT JOB, ABORT MOTION (jog, Frame, a controller
// operation) and the fail-dark stops all run this. Split from
// laser-job-actions when the Marlin quickstop pushed that module past the
// 400-line cap.
//
// A GRBL-family or Smoothieware controller gets its realtime soft reset and
// the beam-off cleanup after the reboot banner, or after a short fallback
// delay. Smoothieware halts instead of rebooting and prints no banner, so its
// qualification is re-armed here (controller audit CG-3). A controller without
// a realtime reset gets the driver's ordered stop lines (Marlin: M107, M410,
// M5 I, then M9 when air may be on; laser-quick-stop.ts) as ordinary lines
// that owe acknowledgements (controller audit MA-7, CG-10). Only a stop that
// sent a reset byte forgets the work origin (MA-3): Marlin keeps its G92
// position_shift through M410 (G92.cpp L95-L98).

import { cancel as cancelStreamer, markErrored, wipeInFlight } from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import type { SerialConnection } from '../../platform/types';
import { clearCncLiveCaps } from './detected-settings-action';
import type { JobStopReason } from './job-stop-request';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import {
  requalifyAfterHaltingReset,
  type ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';
import { releaseHostedRefill } from './laser-hosted-refill';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import { cancelPauseResumeTransition } from './laser-pause-resume-transition';
import {
  driverQuickStops,
  isAirOffLine,
  noResetStopLines,
  quickStopPatch,
} from './laser-quick-stop';
import { armResetCleanup, resetCleanupLines, type ResetCleanupRefs } from './laser-reset-cleanup';
import {
  disconnectStopUnconfirmedNotice,
  isControllerHaltedNotice,
  quickStopUnconfirmedNotice,
  writeFailedNotice,
  type LaserSafetyAction,
} from './laser-safety-notice';
import { finishedJobStateReset, frameProofReset } from './laser-session-reset';
import { originUnknownAfterControllerReset } from './laser-status-line';
import { isActiveJob, pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import { cancelPendingManualMotions } from './manual-motion-intent';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

export type JobStopContext = {
  readonly set: SetFn;
  readonly get: () => LaserState;
  readonly refs: ResetCleanupRefs &
    ControllerLifecycleRefs &
    ControllerQualificationScheduleRefs & {
      readonly driver: ControllerDriver;
      readonly connection?: SerialConnection | null;
    };
  readonly safeWrite: (line: string, action?: LaserSafetyAction) => Promise<void>;
  readonly driver: () => ControllerDriver;
};

type StopOutcome = {
  /** A line that switches air assist off reached the transport. */
  readonly airOffSent: boolean;
  /** The driver's quickstop (Marlin M410): 'sent' once every stop line reached
   * the transport, 'unsent' when a write failed part-way. */
  readonly quickStop: 'none' | 'sent' | 'unsent';
};

const TRANSITION_CANCELLATION_MESSAGE =
  'Pause or Resume was cancelled because the operator requested Abort.';
const QUICK_STOP_LOG =
  '[lf2] Abort quick-stopped the controller (M410): homing and position are unverified until you re-home or re-check the origin.';

export async function runStopJob(context: JobStopContext, reason?: JobStopReason): Promise<void> {
  const { set, refs, driver } = context;
  cancelPendingManualMotions(refs);
  set((state) => ({ manualMotionCancelEpoch: state.manualMotionCancelEpoch + 1 }));
  const softReset = driver().realtime.softReset;
  // Queued stop lines need a single writer, so a controller without a realtime
  // reset takes the hosted refill back first (ADR-334).
  if (softReset === null) await releaseHostedRefill(refs);
  cancelPauseResumeTransition(refs, TRANSITION_CANCELLATION_MESSAGE);
  const outcome =
    softReset === null
      ? await stopWithoutReset(context)
      : await stopWithReset(context, softReset, reason);
  set((state) => ({
    // Abort ends the run, so its machine kind and any tool-change bits it never
    // reached are no longer the operator's pending work.
    ...finishedJobStateReset(),
    wcoCache: null,
    accessoryCache: null,
    // Only a line that switched air off clears the Manual Air latch (CG-10).
    ...(outcome.airOffSent ? { airAssistOn: false } : {}),
    // ADR-228 amendment: Abort during a frame must kill the proof directly —
    // an aborted trace was not completed, whatever the side effects imply.
    ...frameProofReset(),
    ...(softReset === null ? {} : originUnknownAfterControllerReset(state)),
    ...quickStopOutcomePatch(state, outcome.quickStop),
    streamer:
      state.streamer === null
        ? state.streamer
        : softReset !== null
          ? wipeInFlight(cancelStreamer(state.streamer))
          : cancelStreamer(state.streamer),
    ...liveCanvasLifecyclePatch(state, 'stopped'),
  }));
}

async function stopWithReset(
  context: JobStopContext,
  softReset: string,
  reason: JobStopReason | undefined,
): Promise<StopOutcome> {
  const { set, refs, safeWrite, driver } = context;
  clearCncLiveCaps();
  const resetWriteEpoch = refs.writeEpoch ?? 0;
  const cleanupLines = resetCleanupLines(driver());
  // Freeze host refill before the first wire await. If the transport write
  // fails, the controller may still be executing its old buffer; keeping an
  // errored (active) streamer leaves Abort visible without sending more job
  // bytes. Arm cleanup first so an immediate boot banner cannot outrun it.
  set((state) => ({
    ...invalidateControllerSessionEvidence(state),
    streamer: state.streamer === null ? null : markErrored(state.streamer),
    // Recovery reads this beside the errored stream so the saved cause is
    // the requested stop, not an unexplained end (ADR-341 Amendment 3).
    ...(reason === undefined || state.streamer === null
      ? {}
      : { jobStopRequest: { reason, streamerEpoch: state.streamerEpoch } }),
  }));
  requalifyAfterHaltingReset(set, context.get, refs, driver().capabilities);
  armResetCleanup(refs, safeWrite, cleanupLines);
  // The reset goes to the transport before the hosted refill is taken back.
  // A worker that receives it retires its own refill queue (ADR-334 §4), so
  // awaiting the release first only put the Abort byte behind every line
  // the renderer had yet to process, and behind a handshake timer that
  // closes the port. The release still runs, after the reset is posted, so
  // a silent worker is bounded exactly as before.
  const resetWrite = safeWrite(softReset, 'stop');
  void resetWrite.catch(() => undefined);
  await releaseHostedRefill(refs);
  await settleResetWrite(context, resetWrite, resetWriteEpoch);
  // The reset itself de-energizes coolant; the cleanup lines follow the banner.
  return { airOffSent: true, quickStop: 'none' };
}

// A quickstop that may have reached the controller leaves homing and position
// unverified even when a later write failed; the log only reports one that
// was sent in full.
function quickStopOutcomePatch(
  state: LaserState,
  quickStop: StopOutcome['quickStop'],
): Partial<LaserState> {
  if (quickStop === 'none') return {};
  return {
    ...quickStopPatch(state),
    ...(quickStop === 'sent' ? { log: pushLog(state, QUICK_STOP_LOG) } : {}),
  };
}

// Web Serial can deliver the commanded boot banner before write() settles.
// That observed reset boundary is stronger evidence than the stale transport
// promise; only rethrow when no reboot was observed. A port that closed under
// the write proves nothing was delivered.
async function settleResetWrite(
  context: JobStopContext,
  resetWrite: Promise<void>,
  resetWriteEpoch: number,
): Promise<void> {
  try {
    await resetWrite;
  } catch (error) {
    const portClosed = context.refs.connection == null;
    if (!portClosed && (context.refs.writeEpoch ?? 0) > resetWriteEpoch) return;
    if (portClosed) context.set({ safetyNotice: writeFailedNotice('stop') });
    throw error;
  }
}

// No realtime reset (Marlin): cancelling the host streamer is not proof that
// the machine stopped, so the notice is raised before the first await; a
// transport failure may replace it with the stronger write-failed notice.
async function stopWithoutReset(context: JobStopContext): Promise<StopOutcome> {
  const { set, get, safeWrite, driver } = context;
  const activeDriver = driver();
  const quickStopped = driverQuickStops(activeDriver);
  const lines = noResetStopLines(activeDriver, get());
  // A halted controller runs none of the stop lines; its reset advice stays.
  if (isActiveJob(get().streamer) && !isControllerHaltedNotice(get().safetyNotice)) {
    set({
      safetyNotice: quickStopped ? quickStopUnconfirmedNotice() : disconnectStopUnconfirmedNotice(),
    });
  }
  let airOffSent = false;
  let allSent = false;
  try {
    for (const line of lines) {
      await safeWrite(line, 'stop');
      if (isAirOffLine(line)) airOffSent = true;
    }
    allSent = true;
  } catch {
    // Best effort if the transport is already gone.
  }
  return { airOffSent, quickStop: !quickStopped ? 'none' : allSent ? 'sent' : 'unsent' };
}
