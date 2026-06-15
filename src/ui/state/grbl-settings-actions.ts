import {
  CMD_SETTINGS,
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
type SettingsWriteFn = (
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
) => Promise<void>;

export type GrblSettingsActionRefs = {
  settingsCollector: SettingsCollectorState;
};

export function grblSettingsActions(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
): Pick<LaserState, 'readMachineSettings'> {
  return {
    readMachineSettings: async () => {
      const blocked = machineSettingsReadBlockReason(get(), refs);
      if (blocked !== null) return blockRead(set, get, blocked);
      refs.settingsCollector = startCollecting();
      set({
        detectedSettings: null,
        controllerSettings: null,
        grblSettingsRows: [],
        lastSettingsReadAt: null,
      });
      await write(`${CMD_SETTINGS}\n`, 'console', 'console');
    },
  };
}

function machineSettingsReadBlockReason(
  state: LaserState,
  refs: GrblSettingsActionRefs,
): string | null {
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  if (isActiveJob(state.streamer)) return ACTIVE_JOB_COMMAND_MESSAGE;
  if (state.motionOperation !== null) return MOTION_OPERATION_ACTIVE_MESSAGE;
  if (state.autofocusBusy) {
    return 'Auto-focus is running. Wait for it to finish before reading machine settings.';
  }
  if (refs.settingsCollector.kind === 'collecting') {
    return 'Machine settings are already being read. Wait for the current $$ response to finish.';
  }
  return null;
}

function blockRead(set: SetFn, get: GetFn, reason: string): never {
  set({
    lastWriteError: reason,
    log: pushLog(get(), `[lf2] Machine settings read blocked: ${reason}`),
  });
  throw new Error(reason);
}
