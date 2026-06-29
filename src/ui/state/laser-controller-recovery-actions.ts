// Controller recovery actions that are not normal motion/job commands.
// Sleep wake uses GRBL soft reset (Ctrl-X), so it must invalidate any transient
// origin/frame state just like Stop does.

import { RT_SOFT_RESET, cancel as cancelStreamer } from '../../core/controllers/grbl';
import {
  cancelControllerLifecycleRefs,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;

export function controllerRecoveryActions(
  set: SetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'wakeController'> {
  return {
    wakeController: async () => {
      cancelControllerLifecycleRefs(refs, 'Controller recovery started.');
      set({ controllerOperation: { kind: 'recovery', phase: 'reset', idleReports: 0 } });
      try {
        await safeWrite(RT_SOFT_RESET, 'wake');
        set((state) => ({
          statusReport: null,
          alarmCode: null,
          lastError: null,
          wcoCache: null,
          workOriginActive:
            state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown',
          workOriginSource:
            state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown'
              ? 'unknown'
              : 'none',
          frameVerification: null,
          motionOperation: null,
          controllerOperation: { kind: 'recovery', phase: 'awaiting-idle', idleReports: 0 },
          homingState: 'unknown',
          lastWriteError: null,
          streamer: state.streamer === null ? null : cancelStreamer(state.streamer),
          log: pushLog(state, '[lf2] Sent Ctrl-X soft reset. Waiting for fresh Idle.'),
        }));
        await waitForFreshIdle(refs, { kind: 'recovery', requiredReports: 1 });
        set((state) =>
          state.controllerOperation?.kind === 'recovery'
            ? {
                controllerOperation: null,
                log: pushLog(state, '[lf2] Controller recovery confirmed after fresh Idle.'),
              }
            : {},
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set((state) => ({
          controllerOperation:
            state.controllerOperation?.kind === 'recovery' ? null : state.controllerOperation,
          lastWriteError: message,
          log: pushLog(state, `[lf2] Controller recovery failed: ${message}`),
        }));
        throw err;
      }
    },
  };
}
