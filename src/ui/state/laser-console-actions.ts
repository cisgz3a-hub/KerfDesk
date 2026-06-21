import {
  prepareConsoleCommand,
  startCollecting,
  type SettingsCollectorState,
} from '../../core/controllers/grbl';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import type { LaserSafetyAction } from './laser-safety-notice';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  MOTION_OPERATION_ACTIVE_MESSAGE,
  UNKNOWN_IDLE_STATUS_MESSAGE,
  isActiveJob,
  pushLog,
} from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { appendTranscript, systemTranscriptEntry, type TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type ConsoleWriteFn = (
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
) => Promise<void>;

export type ConsoleCommandOptions = {
  readonly confirmed?: boolean;
};

export type ConsoleActionRefs = {
  settingsCollector: SettingsCollectorState;
  nextTranscriptId: number;
};

export function consoleActions(
  set: SetFn,
  get: GetFn,
  refs: ConsoleActionRefs,
  write: ConsoleWriteFn,
): Pick<LaserState, 'sendConsoleCommand' | 'clearTranscript'> {
  return {
    sendConsoleCommand: async (input, options = {}) => {
      const prepared = prepareConsoleCommand(input);
      if (!prepared.ok) return block(set, get, refs, prepared.reason);
      const blocked = consoleCommandBlockReason(get(), prepared.command, false);
      if (blocked !== null) return block(set, get, refs, blocked);
      if (prepared.command.requiresConfirmation && options.confirmed !== true) {
        return block(set, get, refs, 'This persistent setting write needs confirmation.');
      }
      const idleBlocked = consoleCommandBlockReason(get(), prepared.command, true);
      if (idleBlocked !== null) return block(set, get, refs, idleBlocked);
      if (prepared.command.kind === 'settings-query') {
        refs.settingsCollector = startCollecting();
        set({
          detectedSettings: null,
          controllerSettings: null,
          grblSettingsRows: [],
          lastSettingsReadAt: null,
        });
      }
      await write(prepared.command.wire, actionForConsoleCommand(prepared.command.kind), 'console');
    },
    clearTranscript: () => set({ transcript: [] }),
  };
}

function consoleCommandBlockReason(
  state: LaserState,
  command: { readonly requiresIdle: boolean; readonly requiresNoActiveOperation: boolean },
  checkIdle: boolean,
): string | null {
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  if (command.requiresNoActiveOperation) {
    if (isActiveJob(state.streamer)) return ACTIVE_JOB_COMMAND_MESSAGE;
    if (state.motionOperation !== null) return MOTION_OPERATION_ACTIVE_MESSAGE;
    const controllerOperationMessage = controllerOperationCommandBlockMessage(
      state.controllerOperation,
    );
    if (controllerOperationMessage !== null) return controllerOperationMessage;
    if (state.autofocusBusy) {
      return 'Auto-focus is running. Wait for it to finish before sending console commands.';
    }
  }
  if (checkIdle && command.requiresIdle) {
    if (state.statusReport === null) return UNKNOWN_IDLE_STATUS_MESSAGE;
    if (state.statusReport.state !== 'Idle') {
      return `Machine must be Idle before sending this console command (currently ${state.statusReport.state}).`;
    }
  }
  return null;
}

function actionForConsoleCommand(kind: string): LaserSafetyAction {
  return kind === 'unlock' ? 'unlock' : 'console';
}

function block(set: SetFn, get: GetFn, refs: ConsoleActionRefs, reason: string): never {
  const state = get();
  set({
    lastWriteError: reason,
    log: pushLog(state, `[lf2] Console command blocked: ${reason}`),
    transcript: appendTranscript(
      state.transcript,
      systemTranscriptEntry(refs.nextTranscriptId++, Date.now(), reason),
    ),
  });
  throw new Error(reason);
}
