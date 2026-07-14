import {
  idleCollector,
  type GrblSettingRow,
  type SettingsCollectorState,
} from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import { beginSettingsCollection } from './detected-settings-action';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  FIRE_ACTIVE_COMMAND_MESSAGE,
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
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

export type GrblSettingsActionRefs = ControllerLifecycleRefs & {
  driver: ControllerDriver;
  settingsCollector: SettingsCollectorState;
  settingsCollectorSessionEpoch: number | null;
};

export function grblSettingsActions(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
): Pick<LaserState, 'readMachineSettings' | 'writeGrblSetting'> {
  return {
    readMachineSettings: () => readMachineSettingsAction(set, get, refs, write),
    writeGrblSetting: (id, value) => writeGrblSettingAction(set, get, refs, write, id, value),
  };
}

async function readMachineSettingsAction(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
): Promise<void> {
  const settingsQuery = refs.driver.commands.settingsQuery;
  if (settingsQuery === null) {
    return blockRead(set, get, 'This controller does not support a settings dump.');
  }
  const blocked = machineSettingsReadBlockReason(get(), refs);
  if (blocked !== null) return blockRead(set, get, blocked);
  beginSettingsCollection(refs, get().controllerSessionEpoch);
  set({
    controllerOperation: {
      kind: 'interactive-command',
      phase: 'command',
      label: 'Reading controller settings',
    },
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
  try {
    await startControllerCommand(refs, write, {
      kind: 'interactive-command',
      label: 'read controller settings',
      command: `${settingsQuery}\n`,
      action: 'console',
      source: 'console',
    });
    clearInteractiveOperation(set);
  } catch (err) {
    failSettingsOperation(set, get, refs, 'read', err);
  }
}

async function writeGrblSettingAction(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
  id: number,
  value: string,
): Promise<void> {
  if (refs.driver.capabilities.settings !== 'grbl-dollar') {
    return blockWrite(
      set,
      get,
      `${refs.driver.label} does not accept numeric $ setting writes from the app. Configure the controller with its own tools.`,
    );
  }
  const blocked = machineSettingsWriteBlockReason(get(), refs, id, value);
  if (blocked !== null) return blockWrite(set, get, blocked);
  const trimmed = value.trim();
  set({
    controllerOperation: {
      kind: 'interactive-command',
      phase: 'command',
      label: `Writing $${id}`,
    },
  });
  try {
    await writeAndVerifySetting(set, get, refs, write, id, trimmed);
    clearInteractiveOperation(set);
  } catch (err) {
    failSettingsOperation(set, get, refs, 'write', err);
  }
}

async function writeAndVerifySetting(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
  id: number,
  trimmed: string,
): Promise<void> {
  await startControllerCommand(refs, write, {
    kind: 'interactive-command',
    label: `write $${id}`,
    command: `$${id}=${trimmed}\n`,
    action: 'console',
    source: 'console',
  });
  beginSettingsCollection(refs, get().controllerSessionEpoch);
  set({
    controllerOperation: {
      kind: 'interactive-command',
      phase: 'command',
      label: `Verifying $${id}`,
    },
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
  await startControllerCommand(refs, write, {
    kind: 'interactive-command',
    label: 'verify controller settings',
    command: `${refs.driver.commands.settingsQuery ?? '$$'}\n`,
    action: 'console',
    source: 'console',
  });
  if (!settingWasVerified(get, id, trimmed)) {
    throw new Error(`Controller did not report $${id}=${trimmed} after re-read.`);
  }
}

function settingWasVerified(get: GetFn, id: number, trimmed: string): boolean {
  return get().grblSettingsRows.some(
    (row) => row.id === id && Number(row.rawValue) === Number(trimmed),
  );
}

function failSettingsOperation(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  operation: 'read' | 'write',
  err: unknown,
): never {
  refs.settingsCollector = idleCollector();
  refs.settingsCollectorSessionEpoch = null;
  clearInteractiveOperation(set);
  const message = err instanceof Error ? err.message : String(err);
  set({
    lastWriteError: message,
    log: pushLog(get(), `[lf2] Machine settings ${operation} failed: ${message}`),
  });
  throw err instanceof Error ? err : new Error(message);
}

function machineSettingsReadBlockReason(
  state: LaserState,
  refs: GrblSettingsActionRefs,
): string | null {
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  if (state.fireActive) return FIRE_ACTIVE_COMMAND_MESSAGE;
  if (isActiveJob(state.streamer)) return ACTIVE_JOB_COMMAND_MESSAGE;
  if (state.motionOperation !== null) return MOTION_OPERATION_ACTIVE_MESSAGE;
  const controllerOperationMessage = controllerOperationCommandBlockMessage(
    state.controllerOperation,
  );
  if (controllerOperationMessage !== null) return controllerOperationMessage;
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

function clearInteractiveOperation(set: SetFn): void {
  set((state) =>
    state.controllerOperation?.kind === 'interactive-command' ? { controllerOperation: null } : {},
  );
}
