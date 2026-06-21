import {
  startControllerCommand,
  waitForFreshIdle,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { controllerErrorNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const SETTLE_DWELL_COMMAND = 'G4 P0.01\n';
const STABLE_IDLE_REPORTS = 2;

export function beginPostJobSettle(
  set: SetFn,
  get: GetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): void {
  const state = get();
  if (state.streamer?.status !== 'done') return;
  if (state.controllerOperation !== null) return;
  if (refs.controllerCommand !== null || refs.controllerIdleWait !== null) return;
  set({
    controllerOperation: { kind: 'post-job-settle', phase: 'dwell', idleReports: 0 },
    log: pushLog(state, '[lf2] Job lines acknowledged. Settling controller before ready.'),
  });
  void runPostJobSettle(set, refs, safeWrite);
}

async function runPostJobSettle(
  set: SetFn,
  refs: ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  try {
    await startControllerCommand(refs, safeWrite, {
      kind: 'post-job-settle',
      label: 'post-job settle marker',
      command: SETTLE_DWELL_COMMAND,
      action: 'console',
      source: 'system',
    });
    set((state) =>
      state.controllerOperation?.kind === 'post-job-settle'
        ? {
            controllerOperation: {
              kind: 'post-job-settle',
              phase: 'awaiting-idle',
              idleReports: 0,
            },
          }
        : {},
    );
    await waitForFreshIdle(refs, {
      kind: 'post-job-settle',
      requiredReports: STABLE_IDLE_REPORTS,
    });
    set((state) =>
      state.controllerOperation?.kind === 'post-job-settle'
        ? {
            controllerOperation: null,
            streamer: null,
            log: pushLog(state, '[lf2] Controller settled after job.'),
          }
        : {},
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set((state) =>
      state.controllerOperation?.kind === 'post-job-settle'
        ? {
            controllerOperation: {
              ...state.controllerOperation,
              phase: 'failed',
              error: message,
            },
            lastWriteError: message,
            safetyNotice: state.safetyNotice ?? controllerErrorNotice(null, 'command', message),
            log: pushLog(state, `[lf2] Post-job controller settle failed: ${message}`),
          }
        : {},
    );
  }
}
