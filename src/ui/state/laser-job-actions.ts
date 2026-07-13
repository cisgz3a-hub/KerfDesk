// laser-job-actions — Start / Pause / Resume / Stop, extracted from
// laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (autofocus-action, origin-actions): a factory that receives
// the store's set/get plus the connection-bound safe write. Type-only
// LaserState import — no runtime cycle.

import {
  cancel as cancelStreamer,
  continueToolChange as continueToolChangeStreamer,
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
import { extractToolChangeLabels } from '../../core/output';
import { normalizeGrblRxBufferBytes } from '../../core/grbl-streaming';
import { armResetCleanup, type ResetCleanupRefs } from './laser-reset-cleanup';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import {
  assertAutofocusIdle,
  pushLog,
  setupCommandBlockMessage,
  toolChangeContinueBlockMessage,
} from './laser-store-helpers';
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
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob' | 'continueToolChange'> {
  return {
    continueToolChange: () => runContinueToolChange(set, get, safeWrite),
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
      // A lone M0 in a CNC job is a tool-change boundary: swallow it and hold
      // at Idle so the operator can jog/probe/Zero-Z the new bit (CNC-01..03).
      // Laser jobs and imported-in-laser-mode programs keep sending M0 as an
      // ordinary program stop.
      const initial = createStreamer(gcode, {
        ...streamOptions,
        toolChangePause: options.machineKind === 'cnc',
      });
      const stepped = step(initial);
      // Name the bit at each M0 hold: the labels the CNC emitter wrote as
      // comments (the streamer strips them), consumed head-first at entry (R5).
      const labels = options.machineKind === 'cnc' ? extractToolChangeLabels(gcode) : [];
      // A job whose pre-M0 lines all fit the RX buffer reaches the FIRST hold in
      // this synchronous step (no ack); later holds enter via advanceStream.
      const entersHoldNow = stepped.state.status === 'tool-change';
      set((state) => ({
        streamer: stepped.state,
        activeJobMachineKind: options.machineKind ?? 'laser',
        toolChangeLabels: entersHoldNow ? labels.slice(1) : labels,
        pendingToolLabel: entersHoldNow ? (labels[0] ?? null) : null,
        ...toolChangeEntryPatch(state, entersHoldNow),
      }));
      if (stepped.toSend.length === 0) return;
      try {
        await safeWrite(stepped.toSend, 'start');
      } catch (err) {
        set({ streamer: null });
        throw err;
      }
    },
    pauseJob: () => runPauseJob(set, get, safeWrite, driver),
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

function toolChangeEntryPatch(state: LaserState, entersHoldNow: boolean): Partial<LaserState> {
  // A short first tool section can reach M0 synchronously, before the ack path
  // sees a transition. Invalidate the old tool's Z evidence here too.
  return entersHoldNow
    ? {
        workZZeroEvidence: null,
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
        toolChangeIdleSeen: false,
      }
    : {};
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

async function runPauseJob(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Promise<void> {
  const activeDriver = driver();
  const hold = activeDriver.realtime.hold;
  // Realtime feed hold pauses motion instantly but leaves the beam state
  // to the firmware — only provable safe when $32 laser mode is
  // confirmed. ADR-096's exemption is for firmwares that CANNOT report
  // $-settings (settings 'none': Smoothieware ties beam power to motion
  // in its laser module; Marlin has no hold byte and pauses stream-side).
  // Firmwares that CAN report — writable ('grbl-dollar') or read-only
  // ('readonly-dump', FluidNC's $$ compat dump) — keep the strict gate
  // (audit F6). Router jobs are exempt: feed hold with a spindle is
  // standard sender behavior (motion holds, spindle keeps spinning), and
  // a router must have $32=0 — demanding the laser proof would block CNC
  // pause outright.
  const requiresLaserModeProof =
    hold !== null &&
    activeDriver.capabilities.settings !== 'none' &&
    get().activeJobMachineKind !== 'cnc';
  if (requiresLaserModeProof) assertPauseSafe(set, get);
  if (hold !== null) await safeWrite(hold, 'pause');
  const s = get().streamer;
  if (s !== null) set({ streamer: pauseStreamer(s) });
  if (hold === null) {
    get().pushSystemNotice(`[lf2] ${PAUSE_UNSUPPORTED_MESSAGE}`);
  }
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

// Leave a tool-change hold: drop the swallowed M0 and pump the stream from the
// emitter's spindle-off safe-Z lift, followed by M3/G4. Unlike resume there is NO realtime resume byte — the
// controller was never held (the M0 was never sent); it is idling at the park
// position and simply needs the next lines fed. Functional set for the same
// at-write-time snapshot reason as runResumeJob.
async function runContinueToolChange(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
): Promise<void> {
  if (get().streamer?.status !== 'tool-change') return;
  // Fresh Idle proves the pre-M0 retract/park completed; fresh work-Z evidence
  // proves the replacement bit was touched off. Both are required before the
  // stream may issue its spindle-off safe-Z lift and later M3/G4.
  const blockMessage = toolChangeContinueBlockMessage(get());
  if (blockMessage !== null) {
    set({ lastWriteError: blockMessage });
    return;
  }
  let toSend = '';
  set((s) => {
    if (s.streamer === null) return s;
    const stepped = step(continueToolChangeStreamer(s.streamer));
    toSend = stepped.toSend;
    return { streamer: stepped.state };
  });
  if (toSend.length > 0) {
    try {
      await safeWrite(toSend, 'resume');
    } catch (err) {
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
): Pick<
  LaserState,
  'workOriginActive' | 'workOriginSource' | 'workZZeroEvidence' | 'workZReferenceEpoch'
> {
  // A soft reset voids the bit-to-stock Z relationship (Codex audit P1).
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
