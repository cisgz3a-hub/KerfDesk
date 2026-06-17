import {
  CMD_SETTINGS,
  startCollecting,
  type GrblSettingRow,
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
): Pick<LaserState, 'readMachineSettings' | 'writeGrblSetting'> {
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
    writeGrblSetting: async (id, value) => {
      const blocked = machineSettingsWriteBlockReason(get(), refs, id, value);
      if (blocked !== null) return blockWrite(set, get, blocked);
      const trimmed = value.trim();
      await write(`$${id}=${trimmed}\n`, 'console', 'console');
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

function machineSettingsWriteBlockReason(
  state: LaserState,
  refs: GrblSettingsActionRefs,
  id: number,
  value: string,
): string | null {
  const readBlocked = machineSettingsReadBlockReason(state, refs);
  if (readBlocked !== null) return readBlocked;
  if (state.statusReport?.state !== 'Idle') {
    return 'Machine must report Idle before writing firmware settings.';
  }
  if (state.grblSettingsRows.length === 0 || state.lastSettingsReadAt === null) {
    return 'Read and export a controller settings backup before writing firmware settings.';
  }
  const row = state.grblSettingsRows.find((candidate) => candidate.id === id);
  if (row === undefined || row.writeRisk === 'unknown' || row.writeRisk === 'read-only') {
    return `Cannot write unknown or read-only GRBL setting $${id}.`;
  }
  return validateSettingValue(row, value);
}

function validateSettingValue(row: GrblSettingRow, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return `${row.code} value is required.`;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return `${row.code} value must be numeric.`;
  if (row.id === 32 && trimmed !== '0' && trimmed !== '1') {
    return '$32 laser mode must be 0 or 1.';
  }
  if (row.id === 31 && parsed < 0) return '$31 min S must be non-negative.';
  if (row.id === 30 && parsed <= 0) return '$30 max S must be positive.';
  return null;
}

function blockRead(set: SetFn, get: GetFn, reason: string): never {
  set({
    lastWriteError: reason,
    log: pushLog(get(), `[lf2] Machine settings read blocked: ${reason}`),
  });
  throw new Error(reason);
}

function blockWrite(set: SetFn, get: GetFn, reason: string): never {
  set({
    lastWriteError: reason,
    log: pushLog(get(), `[lf2] Machine settings write blocked: ${reason}`),
  });
  throw new Error(reason);
}
