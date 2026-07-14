import { startCollecting, type SettingsCollectorState } from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import type { ConsoleStateEffect } from '../../core/controllers/console-state-effect';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import type { LaserSafetyAction } from './laser-safety-notice';
import {
  ACTIVE_JOB_COMMAND_MESSAGE,
  FIRE_ACTIVE_COMMAND_MESSAGE,
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
  driver: ControllerDriver;
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
      const prepared = refs.driver.prepareConsoleCommand(input);
      if (!prepared.ok) return block(set, get, refs, prepared.reason);
      if (
        prepared.command.kind === 'setting-write' &&
        refs.driver.capabilities.settings !== 'grbl-dollar'
      ) {
        return block(
          set,
          get,
          refs,
          `${refs.driver.label} does not accept numeric $ setting writes from the app. Configure the controller with its own tools.`,
        );
      }
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
      if (commandChangesAccessories(prepared.command.normalized)) {
        // Invalidate before the async write yields so Start cannot race a
        // just-sent M3/M4/M5/M7/M8/M9 while the prior all-off cache remains.
        set((state) => ({
          accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
        }));
      }
      await write(prepared.command.wire, actionForConsoleCommand(prepared.command.kind), 'console');
      const stateEffect = prepared.command.stateEffect;
      if (stateEffect !== 'read-only') {
        set((state) => consoleStateEffectPatch(state, stateEffect, prepared.command.normalized));
      }
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
    if (state.fireActive) return FIRE_ACTIVE_COMMAND_MESSAGE;
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

function consoleStateEffectPatch(
  state: LaserState,
  effect: Exclude<ConsoleStateEffect, 'read-only'>,
  command: string,
): Partial<LaserState> {
  const base: Partial<LaserState> = {
    // A serial write is not proof that buffered motion or modal mutation has
    // physically completed. Require a fresh controller report before another
    // setup/job action can trust Idle or position.
    statusReport: null,
    ...(commandChangesAccessories(command)
      ? { accessoryCache: invalidateAccessoryObservation(state.accessoryCache) }
      : {}),
    frameVerification: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    log: pushLog(
      state,
      `[lf2] Console ${stateEffectLabel(effect)} invalidated cached machine/setup evidence: ${command}`,
    ),
  };
  switch (effect) {
    case 'machine-state':
      return base;
    case 'coordinates-xy':
      return {
        ...base,
        workOriginActive: false,
        workOriginSource: 'none',
        wcoCache: null,
      };
    case 'coordinates-z':
    case 'tool':
      return {
        ...base,
        workZZeroEvidence: null,
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
        wcoCache: null,
      };
    case 'coordinates-all':
      return {
        ...base,
        ...unknownCoordinatePatch(),
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
      };
    case 'reference':
      return {
        ...base,
        ...unknownCoordinatePatch(),
        homingState: 'unknown',
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
      };
    case 'configuration':
      return {
        ...base,
        ...unknownCoordinatePatch(),
        homingState: 'unknown',
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
        detectedSettings: null,
        controllerSettings: null,
        grblSettingsRows: [],
        lastSettingsReadAt: null,
      };
  }
}

function commandChangesAccessories(command: string): boolean {
  const uncommented =
    command
      .replace(/\([^)]*\)/g, ' ')
      .split(';', 1)[0]
      ?.toUpperCase() ?? '';
  return /M0?[345789](?=$|[^0-9.])/.test(uncommented);
}

function unknownCoordinatePatch(): Partial<LaserState> {
  return {
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    wcoCache: null,
  };
}

function stateEffectLabel(effect: Exclude<ConsoleStateEffect, 'read-only'>): string {
  switch (effect) {
    case 'machine-state':
      return 'machine-state command';
    case 'coordinates-xy':
      return 'XY-coordinate command';
    case 'coordinates-z':
      return 'Z-coordinate command';
    case 'coordinates-all':
      return 'coordinate-system command';
    case 'tool':
      return 'tool-state command';
    case 'reference':
      return 'reference-state command';
    case 'configuration':
      return 'configuration command';
  }
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
