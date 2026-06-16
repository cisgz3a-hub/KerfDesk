// laser-job-actions — Start / Pause / Resume / Stop, extracted from
// laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (autofocus-action, origin-actions): a factory that receives
// the store's set/get plus the connection-bound safe write. Type-only
// LaserState import — no runtime cycle.

import {
  CMD_COOLANT_OFF,
  RT_HOLD,
  RT_RESUME,
  RT_SOFT_RESET,
  cancel as cancelStreamer,
  createStreamer,
  findOversizedLine,
  markErrored,
  pause as pauseStreamer,
  resume as resumeStreamer,
  step,
  type CreateStreamerOptions,
} from '../../core/controllers/grbl';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import { assertAutofocusIdle, pushLog, setupCommandBlockMessage } from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;
type StartJobDevice = Parameters<LaserState['startJob']>[1];

function streamerOptionsForDevice(device: StartJobDevice): CreateStreamerOptions {
  if (device === undefined) return {};
  return {
    rxBufferBytes: device.controller.rxBufferBytes,
    streamingMode: device.controller.streamingMode,
    pollDuringJob: device.controller.pollDuringJob,
  };
}

export function jobActions(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob'> {
  return {
    startJob: async (gcode, device) => {
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
      const streamerOptions = streamerOptionsForDevice(device);
      const oversized = findOversizedLine(gcode, streamerOptions.rxBufferBytes);
      if (oversized !== null) {
        throw new Error(
          `G-code line ${oversized.lineNumber} is ${oversized.bytes} bytes — longer than the ` +
            `controller's ${oversized.limit}-byte RX buffer; it can never be sent. Job not started.`,
        );
      }
      const initial = createStreamer(gcode, streamerOptions);
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
      await safeWrite(RT_HOLD, 'pause');
      const s = get().streamer;
      if (s !== null) set({ streamer: pauseStreamer(s) });
    },
    resumeJob: async () => {
      await safeWrite(RT_RESUME, 'resume');
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
    },
    stopJob: async () => {
      await safeWrite(RT_SOFT_RESET, 'stop');
      try {
        await safeWrite(`${CMD_COOLANT_OFF}\n`, 'stop');
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
        workOriginActive: false,
        homingState: 'unknown',
        streamer: s.streamer !== null ? cancelStreamer(s.streamer) : s.streamer,
      }));
    },
  };
}
