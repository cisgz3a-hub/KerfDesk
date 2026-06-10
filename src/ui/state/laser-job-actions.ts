// laser-job-actions — Start / Pause / Resume / Stop, extracted from
// laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (autofocus-action, origin-actions): a factory that receives
// the store's set/get plus the connection-bound safe write. Type-only
// LaserState import — no runtime cycle.

import {
  RT_HOLD,
  RT_RESUME,
  RT_SOFT_RESET,
  cancel as cancelStreamer,
  createStreamer,
  disconnect as disconnectStreamer,
  findOversizedLine,
  pause as pauseStreamer,
  resume as resumeStreamer,
  step,
} from '../../core/controllers/grbl';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import { assertAutofocusIdle } from './laser-store-helpers';
import type { LaserState } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;

export function jobActions(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob'> {
  return {
    startJob: async (gcode) => {
      assertAutofocusIdle(get());
      // M13: a line longer than the RX buffer can never send — step() would
      // break silently, leaving a phantom idle job and a frozen progress bar.
      const oversized = findOversizedLine(gcode);
      if (oversized !== null) {
        throw new Error(
          `G-code line ${oversized.lineNumber} is ${oversized.bytes} bytes — longer than the ` +
            `controller's ${oversized.limit}-byte RX buffer; it can never be sent. Job not started.`,
        );
      }
      const initial = createStreamer(gcode);
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
          set((s) => ({
            streamer: s.streamer === null ? s.streamer : disconnectStreamer(s.streamer),
            safetyNotice: writeFailedNotice('resume'),
          }));
          throw err;
        }
      }
    },
    stopJob: async () => {
      await safeWrite(RT_SOFT_RESET, 'stop');
      // Soft reset clears G92 in GRBL (alarm 1 reaction). Drop our
      // cached WCO so the readout doesn't lie about "custom origin"
      // until the next WCO frame arrives. Same race window as
      // resumeJob — use functional set.
      set((s) => ({
        wcoCache: null,
        workOriginActive: false,
        streamer: s.streamer !== null ? cancelStreamer(s.streamer) : s.streamer,
      }));
    },
  };
}
