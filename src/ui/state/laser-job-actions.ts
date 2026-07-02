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
  type CreateStreamerOptions,
} from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import { normalizeGrblRxBufferBytes } from '../../core/grbl-streaming';
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

export function jobActions(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob'> {
  return {
    startJob: async (gcode, options = {}) => {
      assertAutofocusIdle(get());
      const blockedMessage = setupCommandBlockMessage(get());
      if (blockedMessage !== null) {
        set({
          lastWriteError: blockedMessage,
          log: pushLog(get(), `[lf2] Motion command blocked: ${blockedMessage}`),
        });
        throw new Error(blockedMessage);
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
      set({ streamer: stepped.state });
      if (stepped.toSend.length === 0) return;
      try {
        await safeWrite(stepped.toSend, 'start');
      } catch (err) {
        set({ streamer: null });
        throw err;
      }
    },
    pauseJob: async () => {
      const hold = driver().realtime.hold;
      // Realtime feed hold pauses motion instantly but leaves the beam state
      // to the firmware — only safe when laser mode is confirmed. Firmwares
      // without a hold byte (Marlin) pause stream-side instead: the streamer
      // stops sending and buffered motion drains.
      if (hold !== null) assertPauseSafe(set, get);
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
      try {
        for (const line of driver().commands.stopLaserLines) {
          await safeWrite(`${line}\n`, 'stop');
        }
      } catch {
        // Soft reset is the safety-critical command; coolant cleanup is best
        // effort and may fail if the serial link is already gone.
      }
      // Soft reset clears G92 in GRBL (alarm 1 reaction). Drop our
      // cached WCO so the readout doesn't lie about "custom origin"
      // until the next WCO frame arrives. Same race window as
      // resumeJob — use functional set.
      set((s) => ({
        wcoCache: null,
        ...originPatchAfterSoftReset(s),
        streamer: s.streamer !== null ? cancelStreamer(s.streamer) : s.streamer,
      }));
    },
  };
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
