// Controller recovery actions that are not normal motion/job commands.
// Sleep wake uses GRBL soft reset (Ctrl-X), so it must invalidate any transient
// origin/frame state just like Stop does.

import { RT_SOFT_RESET, cancel as cancelStreamer } from '../../core/controllers/grbl';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;

export function controllerRecoveryActions(
  set: SetFn,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'wakeController'> {
  return {
    wakeController: async () => {
      await safeWrite(RT_SOFT_RESET, 'wake');
      set((state) => ({
        statusReport: null,
        alarmCode: null,
        lastError: null,
        wcoCache: null,
        workOriginActive: false,
        frameVerification: null,
        motionOperation: null,
        homingState: 'unknown',
        streamer: state.streamer === null ? null : cancelStreamer(state.streamer),
        log: pushLog(state, '[lf2] Sent Ctrl-X soft reset to wake GRBL. Wait for Idle.'),
      }));
    },
  };
}
