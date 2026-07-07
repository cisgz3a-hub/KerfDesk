// laser-job-actions — Start / Pause / Resume / Stop, extracted from
// laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (autofocus-action, origin-actions): a factory that receives
// the store's set/get plus the connection-bound safe write. Type-only
// LaserState import — no runtime cycle.

import {
  cancel as cancelStreamer,
  createStreamer,
  findOversizedLine,
  markErrored,
  pause as pauseStreamer,
  resume as resumeStreamer,
  step,
  wipeInFlight,
  type CreateStreamerOptions,
} from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import { normalizeGrblRxBufferBytes } from '../../core/grbl-streaming';
import { armResetCleanup, type ResetCleanupRefs } from './laser-reset-cleanup';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import { assertAutofocusIdle, pushLog, setupCommandBlockMessage } from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;
type DriverFn = () => ControllerDriver;

const PAUSE_REQUIRES_LASER_MODE_MESSAGE =
  'Pause requires confirmed GRBL laser mode ($32=1). Use Stop instead; feed hold can leave the laser on when $32=0 or unknown.';
const PAUSE_UNSUPPORTED_MESSAGE =
  'This controller has no realtime feed hold. Pause is stream-side only: sending stops, but buffered motion finishes. Use Stop for an immediate halt.';
// GRBL acks in strict receive order: an ok still owed to a console/origin/
// handshake write, mis-attributed to a fresh job stream, frees RX budget the
// controller has not freed — the phantom refill can overflow the real buffer
// mid-burn. Start briefly waits for the owed acks; a controller that stays
// silent past this budget is a connection problem the operator must see.
const UNTRACKED_ACK_DRAIN_TIMEOUT_MS = 1_500;
const UNTRACKED_ACK_DRAIN_POLL_MS = 25;
const START_PENDING_ACK_MESSAGE =
  'The controller has not acknowledged a previous command yet. Start was blocked so the stale ' +
  'acknowledgement cannot corrupt the job stream — check the connection and try again.';

export function jobActions(
  set: SetFn,
  get: GetFn,
  refs: ResetCleanupRefs,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob'> {
  return {
    startJob: async (gcode, options = {}) => {
      assertStartAllowed(set, get);
      if (get().pendingUntrackedAcks > 0) {
        await waitForUntrackedAckDrain(get);
        // The wait yielded the task queue — anything could have changed
        // (another Start, an alarm, a disconnect). Re-assert every guard so
        // the synchronous double-start protection below still holds.
        assertStartAllowed(set, get);
      }
      // M13: a line longer than the RX buffer can never send — step() would
      // break silently, leaving a phantom idle job and a frozen progress bar.
      const streamOptions = normalizeStartJobOptions(options);
      const oversized = findOversizedLine(gcode, streamOptions.rxBufferBytes);
      if (oversized !== null) {
        throw new Error(
          `G-code line ${oversized.lineNumber} is ${oversized.bytes} bytes — longer than the ` +
            `controller's ${oversized.limit}-byte RX buffer; it can never be sent. Job not started.`,
        );
      }
      const initial = createStreamer(gcode, streamOptions);
      const stepped = step(initial);
      set({ streamer: stepped.state, activeJobMachineKind: options.machineKind ?? 'laser' });
      if (stepped.toSend.length === 0) return;
      try {
        await safeWrite(stepped.toSend, 'start');
      } catch (err) {
        set({ streamer: null });
        throw err;
      }
    },
    pauseJob: async () => {
      const activeDriver = driver();
      const hold = activeDriver.realtime.hold;
      // Realtime feed hold pauses motion instantly but leaves the beam state
      // to the firmware — only provable safe when $32 laser mode is confirmed,
      // which only grbl-dollar firmwares can report. Smoothieware ties beam
      // power to motion in its laser module, so hold is accepted without the
      // $32 proof there. Firmwares without a hold byte (Marlin) pause
      // stream-side instead: the streamer stops sending and buffered motion
      // drains.
      // Router jobs are exempt: feed hold with a spindle is standard sender
      // behavior (motion holds, spindle keeps spinning), and a router must
      // have $32=0 — demanding the laser proof would block CNC pause outright.
      const requiresLaserModeProof =
        hold !== null &&
        activeDriver.capabilities.settings === 'grbl-dollar' &&
        get().activeJobMachineKind !== 'cnc';
      if (requiresLaserModeProof) assertPauseSafe(set, get);
      if (hold !== null) await safeWrite(hold, 'pause');
      const s = get().streamer;
      if (s !== null) set({ streamer: pauseStreamer(s) });
      if (hold === null) {
        set({ log: pushLog(get(), `[lf2] ${PAUSE_UNSUPPORTED_MESSAGE}`) });
      }
    },
    resumeJob: () => runResumeJob(set, safeWrite, driver),
    stopJob: async () => {
      const softReset = driver().realtime.softReset;
      if (softReset !== null) await safeWrite(softReset, 'stop');
      if (softReset === null) {
        // Stream-side stop (Marlin): no reset, no reboot — the beam-off
        // lines go out immediately and their acks queue behind the
        // in-flight job lines in receive order.
        try {
          for (const line of driver().commands.stopLaserLines) {
            await safeWrite(`${line}\n`, 'stop');
          }
        } catch {
          // Coolant cleanup is best effort and may fail if the serial link
          // is already gone.
        }
      }
      // Soft reset clears G92 in GRBL (alarm 1 reaction). Drop our
      // cached WCO so the readout doesn't lie about "custom origin"
      // until the next WCO frame arrives. Same race window as
      // resumeJob — use functional set.
      // A sent soft reset also wiped the firmware's RX buffer: the
      // in-flight lines will never be acked, so drop them from the
      // accounting or the beam-off cleanup acks get claimed by the dead
      // stream (audit F1). Stream-side stops (Marlin) keep in-flight —
      // the firmware still acks those lines.
      set((s) => ({
        wcoCache: null,
        airAssistOn: false,
        ...originPatchAfterSoftReset(s),
        streamer:
          s.streamer === null
            ? s.streamer
            : softReset !== null
              ? wipeInFlight(cancelStreamer(s.streamer))
              : cancelStreamer(s.streamer),
      }));
      // After a sent reset, the beam-off cleanup is deferred until the boot
      // banner arrives (audit F2): written now it races the reboot — either
      // swallowed mid-init (its ack never comes, the counter jams) or acked
      // after the banner reset the untracked ledger (an orphaned ok). The
      // soft reset itself already de-energized laser and coolant.
      if (softReset !== null) {
        armResetCleanup(refs, safeWrite, driver().commands.stopLaserLines);
      }
    },
  };
}

function assertStartAllowed(set: SetFn, get: GetFn): void {
  assertAutofocusIdle(get());
  const blockedMessage = setupCommandBlockMessage(get());
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Motion command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

async function waitForUntrackedAckDrain(get: GetFn): Promise<void> {
  const deadline = Date.now() + UNTRACKED_ACK_DRAIN_TIMEOUT_MS;
  while (get().pendingUntrackedAcks > 0) {
    if (Date.now() > deadline) throw new Error(START_PENDING_ACK_MESSAGE);
    await sleep(UNTRACKED_ACK_DRAIN_POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runResumeJob(set: SetFn, safeWrite: SafeWriteFn, driver: DriverFn): Promise<void> {
  const resumeByte = driver().realtime.resume;
  if (resumeByte !== null) await safeWrite(resumeByte, 'resume');
  // Functional set so the snapshot is taken AT WRITE TIME — during
  // the await above, ack-driven handleLine paths can have advanced
  // the streamer via advanceStream. A `const s = get().streamer`
  // before the set would clobber those concurrent updates with a
  // state derived from a stale snapshot, drifting the in-flight
  // accounting against the real GRBL 127-byte buffer (R-H2 audit
  // finding). On a laser cutter, accounting drift can push more
  // bytes than the buffer holds → dropped commands → uncontrolled
  // head motion.
  let toSend = '';
  set((s) => {
    if (s.streamer === null) return s;
    const stepped = step(resumeStreamer(s.streamer));
    toSend = stepped.toSend;
    return { streamer: stepped.state };
  });
  if (toSend.length > 0) {
    try {
      await safeWrite(toSend, 'resume');
    } catch (err) {
      // markErrored, not disconnect: 'disconnected' falls outside
      // isActiveJob, which unmounts the Stop button and drops the
      // soft-reset stop command while GRBL may still be executing
      // buffered lines on a live port. 'errored' keeps the recovery
      // controls mounted; step() sends nothing further either way.
      set((s) => ({
        streamer: s.streamer === null ? s.streamer : markErrored(s.streamer),
        safetyNotice: writeFailedNotice('resume'),
      }));
      throw err;
    }
  }
}

function originPatchAfterSoftReset(
  state: LaserState,
): Pick<LaserState, 'workOriginActive' | 'workOriginSource'> {
  if (state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown') {
    return { workOriginActive: true, workOriginSource: 'unknown' };
  }
  return { workOriginActive: false, workOriginSource: 'none' };
}

function normalizeStartJobOptions(options: CreateStreamerOptions): CreateStreamerOptions {
  return {
    ...options,
    rxBufferBytes: normalizeGrblRxBufferBytes(options.rxBufferBytes),
  };
}

function assertPauseSafe(set: SetFn, get: GetFn): void {
  const blockedMessage = pauseLaserModeBlockMessage(get());
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Pause blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

function pauseLaserModeBlockMessage(state: LaserState): string | null {
  return state.controllerSettings?.laserModeEnabled === true
    ? null
    : PAUSE_REQUIRES_LASER_MODE_MESSAGE;
}
