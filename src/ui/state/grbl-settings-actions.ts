import {
  idleCollector,
  type GrblSettingRow,
  type SettingsCollectorState,
} from '../../core/controllers/grbl';
import { grblSettingMachineKindIssue } from '../../core/controllers/grbl/grbl-setting-write';
import type { ControllerDriver } from '../../core/controllers';
import { machineKindOf, type MachineKind } from '../../core/scene';
import { useStore } from './store';
import { requestActiveWcsReadback } from './active-wcs-readback';
import { beginSettingsCollection, SETTINGS_READ_OPERATION_LABEL } from './detected-settings-action';
import {
  failedControllerQualificationPatch,
  qualifiedController,
  qualifyingController,
} from './laser-controller-qualification';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';

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
  const blocked = machineSettingsReadBlockReason(get(), {
    settingsCollectionActive: refs.settingsCollector.kind === 'collecting',
  });
  if (blocked !== null) return blockRead(set, get, blocked);
  const qualificationEpoch = get().controllerSessionEpoch;
  if (settingsQuery === null) {
    set((state) => ({
      controllerQualification: qualifiedController(qualificationEpoch, 'not-required'),
      lastWriteError: null,
      log: pushLog(
        state,
        `[lf2] ${refs.driver.label} does not require a controller settings dump.`,
      ),
    }));
    return;
  }
  beginSettingsCollection(refs, qualificationEpoch);
  set({
    controllerOperation: {
      kind: 'interactive-command',
      phase: 'command',
      label: SETTINGS_READ_OPERATION_LABEL,
    },
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerQualification: qualifyingController(qualificationEpoch, 'settings-read'),
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
    finishSettingsQualification(set, get, refs, qualificationEpoch);
    clearInteractiveOperation(set, qualificationEpoch);
    // A reset banner nulls activeWcs and this action is the post-reset
    // re-qualification (refs.runControllerQualification), so a completed read
    // is the earliest safe point to re-seed the C6 advisory's modal state.
    await requestActiveWcsReadback(get, refs.driver, write, qualificationEpoch);
  } catch (err) {
    failSettingsOperation(set, refs, qualificationEpoch, 'read', err);
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
  const blocked = machineSettingsWriteBlockReason(
    get(),
    refs,
    machineKindOf(useStore.getState().project.machine),
    id,
    value,
  );
  if (blocked !== null) return blockWrite(set, get, blocked);
  const qualificationEpoch = get().controllerSessionEpoch;
  const trimmed = value.trim();
  set({
    controllerOperation: {
      kind: 'interactive-command',
      phase: 'command',
      label: `Writing $${id}`,
    },
  });
  try {
    await writeAndVerifySetting(set, get, refs, write, qualificationEpoch, id, trimmed);
    clearInteractiveOperation(set, qualificationEpoch);
  } catch (err) {
    failSettingsOperation(set, refs, qualificationEpoch, 'write', err);
  }
}

async function writeAndVerifySetting(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
  qualificationEpoch: number,
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
  if (get().controllerSessionEpoch !== qualificationEpoch) {
    throw new Error('Controller session changed while writing the machine setting.');
  }
  beginSettingsCollection(refs, qualificationEpoch);
  set({
    controllerOperation: {
      kind: 'interactive-command',
      phase: 'command',
      label: `Verifying $${id}`,
    },
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerQualification: qualifyingController(qualificationEpoch, 'settings-read'),
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
  if (get().controllerSessionEpoch !== qualificationEpoch) {
    throw new Error('Controller session changed while verifying the machine setting.');
  }
  finishSettingsQualification(set, get, refs, qualificationEpoch);
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
  refs: GrblSettingsActionRefs,
  expectedEpoch: number,
  operation: 'read' | 'write',
  err: unknown,
): never {
  if (refs.settingsCollectorSessionEpoch === expectedEpoch) {
    refs.settingsCollector = idleCollector();
    refs.settingsCollectorSessionEpoch = null;
  }
  const message = err instanceof Error ? err.message : String(err);
  set((state) =>
    state.controllerSessionEpoch === expectedEpoch
      ? {
          ...failedControllerQualificationPatch(state, expectedEpoch, message),
          ...(state.controllerOperation?.kind === 'interactive-command'
            ? { controllerOperation: null }
            : {}),
          lastWriteError: message,
          log: pushLog(state, `[lf2] Machine settings ${operation} failed: ${message}`),
        }
      : {},
  );
  throw err instanceof Error ? err : new Error(message);
}

function finishSettingsQualification(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  expectedEpoch: number,
): void {
  const state = get();
  if (state.controllerSessionEpoch !== expectedEpoch) return;
  if (
    state.controllerQualification.kind === 'qualified' &&
    state.controllerQualification.epoch === expectedEpoch
  ) {
    return;
  }
  if (refs.settingsCollectorSessionEpoch === expectedEpoch) {
    refs.settingsCollector = idleCollector();
    refs.settingsCollectorSessionEpoch = null;
  }
  set((current) =>
    failedControllerQualificationPatch(
      current,
      expectedEpoch,
      'The controller settings response was empty. Retry reading controller settings.',
    ),
  );
}

function machineSettingsWriteBlockReason(
  state: LaserState,
  refs: GrblSettingsActionRefs,
  machineKind: MachineKind,
  id: number,
  value: string,
): string | null {
  const readBlocked = machineSettingsReadBlockReason(state, {
    settingsCollectionActive: refs.settingsCollector.kind === 'collecting',
  });
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
  const machineKindIssue = grblSettingMachineKindIssue(machineKind, id, value);
  if (machineKindIssue !== null) return machineKindIssue;
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

function clearInteractiveOperation(set: SetFn, expectedEpoch: number): void {
  set((state) =>
    state.controllerSessionEpoch === expectedEpoch &&
    state.controllerOperation?.kind === 'interactive-command'
      ? { controllerOperation: null }
      : {},
  );
}
