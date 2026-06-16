import {
  CMD_BUILD_INFO,
  CMD_MODAL_STATE,
  CMD_OFFSETS,
  CMD_SETTINGS,
  RT_STATUS,
  idleCollector,
  startCollecting,
  type SettingsCollectorState,
} from '../../core/controllers/grbl';
import type { LaserSafetyAction } from './laser-safety-notice';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  MOTION_OPERATION_ACTIVE_MESSAGE,
  isActiveJob,
  pushLog,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type DiagnosticWriteFn = (
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
) => Promise<void>;

export type MachineDiagnosticActionRefs = {
  settingsCollector: SettingsCollectorState;
};

export function machineDiagnosticActions(
  set: SetFn,
  get: GetFn,
  refs: MachineDiagnosticActionRefs,
  write: DiagnosticWriteFn,
): Pick<LaserState, 'runMachineDiagnostic'> {
  return {
    runMachineDiagnostic: async () => {
      const blocked = machineDiagnosticBlockReason(get());
      if (blocked !== null) return blockDiagnostic(set, get, blocked);
      refs.settingsCollector = startCollecting();
      set({
        detectedSettings: null,
        controllerSettings: null,
        grblSettingsRows: [],
        lastSettingsReadAt: null,
      });
      try {
        await write(`${CMD_BUILD_INFO}\n`, 'console', 'console');
        await write(`${CMD_SETTINGS}\n`, 'console', 'console');
        await write(`${CMD_OFFSETS}\n`, 'console', 'console');
        await write(`${CMD_MODAL_STATE}\n`, 'console', 'console');
        await write(RT_STATUS, 'console', 'console');
      } catch (err) {
        refs.settingsCollector = idleCollector();
        throw err;
      }
    },
  };
}

function machineDiagnosticBlockReason(state: LaserState): string | null {
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  if (isActiveJob(state.streamer)) return ACTIVE_JOB_COMMAND_MESSAGE;
  if (state.motionOperation !== null) return MOTION_OPERATION_ACTIVE_MESSAGE;
  if (state.autofocusBusy) {
    return 'Auto-focus is running. Wait for it to finish before running diagnostics.';
  }
  return null;
}

function blockDiagnostic(set: SetFn, get: GetFn, reason: string): never {
  set({
    lastWriteError: reason,
    log: pushLog(get(), `[lf2] Machine diagnostic blocked: ${reason}`),
  });
  throw new Error(reason);
}
