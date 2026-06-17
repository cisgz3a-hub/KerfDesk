import {
  CMD_SETTINGS,
  buildGrblSettingWrite,
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
  settingWriteAck: PendingSettingWriteAck | null;
  settingsReadComplete: PendingSettingsRead | null;
};

type PendingSettingWriteAck = {
  readonly command: string;
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

type PendingSettingsRead = {
  readonly resolve: (rows: ReadonlyArray<GrblSettingRow>) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

const SETTING_WRITE_ACK_TIMEOUT_MS = 5000;
const SETTING_VERIFY_TIMEOUT_MS = 8000;

export function grblSettingsActions(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
): Pick<
  LaserState,
  'readMachineSettings' | 'markMachineSettingsBackupExported' | 'writeGrblSetting'
> {
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
        settingsBackupExportedAt: null,
      });
      await write(`${CMD_SETTINGS}\n`, 'console', 'console');
    },
    markMachineSettingsBackupExported: () => set({ settingsBackupExportedAt: Date.now() }),
    writeGrblSetting: async (id, value, confirmation) => {
      const state = get();
      const blocked = machineSettingsWriteBlockReason(state, refs);
      if (blocked !== null) return blockWrite(set, get, blocked);
      const result = buildGrblSettingWrite({
        rows: state.grblSettingsRows,
        id,
        value,
        confirmation,
        backupFresh: backupIsFresh(state),
      });
      if (result.kind === 'blocked') return blockWrite(set, get, result.reason);
      await writeSettingAndWaitForAck(set, get, refs, write, result.command);
      refs.settingsCollector = startCollecting();
      set({
        detectedSettings: null,
        controllerSettings: null,
        grblSettingsRows: [],
        lastSettingsReadAt: null,
        settingsBackupExportedAt: null,
        log: pushLog(get(), `[lf2] Wrote guarded GRBL setting ${result.command}; re-reading $$...`),
      });
      const rows = await readSettingsAndWaitForCompletion(refs, write);
      const verified = rows.find((row) => row.id === id);
      if (verified === undefined || !settingValueMatches(verified.rawValue, value)) {
        return blockWrite(
          set,
          get,
          `Controller did not verify ${result.command} after re-reading $$.`,
        );
      }
      set({
        log: pushLog(get(), `[lf2] Verified guarded GRBL setting ${result.command}.`),
      });
    },
  };
}

export function resolvePendingSettingWriteAck(
  refs: GrblSettingsActionRefs,
  kind: 'ok' | 'error' | 'alarm',
  code?: number,
): void {
  const pending = refs.settingWriteAck;
  if (pending === null) return;
  refs.settingWriteAck = null;
  clearTimeout(pending.timer);
  if (kind === 'ok') {
    pending.resolve();
    return;
  }
  pending.reject(new Error(`Controller rejected ${pending.command} with ${kind}${code ?? ''}.`));
}

export function resolvePendingSettingsRead(
  refs: GrblSettingsActionRefs,
  rows: ReadonlyArray<GrblSettingRow>,
): void {
  const pending = refs.settingsReadComplete;
  if (pending === null) return;
  refs.settingsReadComplete = null;
  clearTimeout(pending.timer);
  pending.resolve(rows);
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
): string | null {
  const readBlock = machineSettingsReadBlockReason(state, refs);
  if (readBlock !== null) return readBlock;
  if (state.statusReport === null) return 'Wait for an Idle status report before writing settings.';
  if (state.statusReport.state !== 'Idle') {
    return `Machine must be Idle before writing settings (currently ${state.statusReport.state}).`;
  }
  return null;
}

function backupIsFresh(
  state: Pick<LaserState, 'lastSettingsReadAt' | 'settingsBackupExportedAt'>,
): boolean {
  return (
    state.lastSettingsReadAt !== null &&
    state.settingsBackupExportedAt !== null &&
    state.settingsBackupExportedAt >= state.lastSettingsReadAt
  );
}

async function writeSettingAndWaitForAck(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
  command: `$${number}=${string}`,
): Promise<void> {
  const ack = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (refs.settingWriteAck?.command === command) refs.settingWriteAck = null;
      reject(new Error(`Timed out waiting for controller ok after ${command}.`));
    }, SETTING_WRITE_ACK_TIMEOUT_MS);
    refs.settingWriteAck = { command, resolve, reject, timer };
  });

  try {
    await write(`${command}\n`, 'console', 'console');
    await ack;
  } catch (err) {
    refs.settingWriteAck = null;
    const reason = err instanceof Error ? err.message : String(err);
    return blockWrite(set, get, reason);
  }
}

async function readSettingsAndWaitForCompletion(
  refs: GrblSettingsActionRefs,
  write: SettingsWriteFn,
): Promise<ReadonlyArray<GrblSettingRow>> {
  const completion = new Promise<ReadonlyArray<GrblSettingRow>>((resolve, reject) => {
    const timer = setTimeout(() => {
      refs.settingsReadComplete = null;
      reject(new Error('Timed out waiting for $$ verification read.'));
    }, SETTING_VERIFY_TIMEOUT_MS);
    refs.settingsReadComplete = { resolve, reject, timer };
  });
  try {
    await write(`${CMD_SETTINGS}\n`, 'console', 'console');
    return await completion;
  } catch (err) {
    refs.settingsReadComplete = null;
    throw err;
  }
}

function settingValueMatches(actual: string, expected: string): boolean {
  const actualTrimmed = actual.trim();
  const expectedTrimmed = expected.trim();
  const actualNumber = Number(actualTrimmed);
  const expectedNumber = Number(expectedTrimmed);
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return Math.abs(actualNumber - expectedNumber) < 1e-9;
  }
  return actualTrimmed === expectedTrimmed;
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
