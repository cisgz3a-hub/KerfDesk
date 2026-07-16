import type { SettingsCollectorState } from '../../core/controllers/grbl';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import { grblSettingCommandMachineKindIssue } from '../../core/controllers/grbl/grbl-setting-write';
import type { ControllerDriver } from '../../core/controllers';
import { machineKindOf } from '../../core/scene';
import { beginSettingsCollection } from './detected-settings-action';
import {
  hasAccessoryCommand,
  type ConsoleStateEffect,
} from '../../core/controllers/console-state-effect';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import { hasPendingControllerWrite } from './laser-start-queue-fence';
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
import { useStore } from './store';

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

export type ConsoleActionRefs = ControllerLifecycleRefs & {
  driver: ControllerDriver;
  settingsCollector: SettingsCollectorState;
  settingsCollectorSessionEpoch: number | null;
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
      const settingWriteBlocked = consoleSettingWriteBlockReason(refs.driver, prepared.command);
      if (settingWriteBlocked !== null) return block(set, get, refs, settingWriteBlocked);
      const blocked = consoleCommandBlockReason(get(), prepared.command, false);
      if (blocked !== null) return block(set, get, refs, blocked);
      const ownershipBlocked = consoleOwnershipBlockReason(get(), refs, prepared.command);
      if (ownershipBlocked !== null) return block(set, get, refs, ownershipBlocked);
      if (prepared.command.requiresConfirmation && options.confirmed !== true) {
        return block(set, get, refs, 'This persistent setting write needs confirmation.');
      }
      const idleBlocked = consoleCommandBlockReason(get(), prepared.command, true);
      if (idleBlocked !== null) return block(set, get, refs, idleBlocked);
      if (prepared.command.kind === 'settings-query') {
        beginSettingsCollection(refs, get().controllerSessionEpoch);
        set({
          detectedSettings: null,
          controllerSettings: null,
          controllerSettingsObservation: null,
          grblSettingsRows: [],
          lastSettingsReadAt: null,
        });
      }
      if (hasAccessoryCommand(prepared.command.normalized)) {
        // Invalidate before the async write yields so Start cannot race a
        // just-sent M3/M4/M5/M7/M8/M9 while the prior all-off cache remains.
        set((state) => ({
          accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
        }));
      }
      await writeConsoleCommand(refs, write, prepared.command);
      const stateEffect = prepared.command.stateEffect;
      if (stateEffect !== 'read-only') {
        set((state) => consoleStateEffectPatch(state, stateEffect, prepared.command.normalized));
      }
      // Track the operator's active WCS selection so save/start advisories can
      // warn when it is not the G54 that emission pins (audit C6).
      trackConsoleWcsSelection(set, prepared.command.normalized);
    },
    clearTranscript: () => set({ transcript: [] }),
  };
}

function writeConsoleCommand(
  refs: ConsoleActionRefs,
  write: ConsoleWriteFn,
  command: {
    readonly kind: string;
    readonly normalized: string;
    readonly wire: string;
  },
): Promise<unknown> {
  if (isOwnedControllerIdentityCommand(refs, command)) {
    return startControllerCommand(
      refs,
      (line, action, source) => write(line, action, source ?? 'console'),
      {
        kind: 'controller-identity',
        label: 'Read controller firmware identity',
        command: command.wire,
        action: actionForConsoleCommand(command.kind),
        source: 'console',
      },
    );
  }
  return write(command.wire, actionForConsoleCommand(command.kind), 'console');
}

function isOwnedControllerIdentityCommand(
  refs: Pick<ConsoleActionRefs, 'driver'>,
  command: { readonly normalized: string },
): boolean {
  return refs.driver.kind === 'marlin' && command.normalized.trim().toUpperCase() === 'M115';
}

function consoleOwnershipBlockReason(
  state: LaserState,
  refs: ConsoleActionRefs,
  command: { readonly normalized: string },
): string | null {
  if (refs.controllerCommand !== null) return 'Wait for the current controller command to finish.';
  if (isOwnedControllerIdentityCommand(refs, command) && hasPendingControllerWrite(state)) {
    return 'Wait for the previous controller write and acknowledgement before reading controller firmware identity.';
  }
  return null;
}

function consoleSettingWriteBlockReason(
  driver: ControllerDriver,
  command: { readonly kind: string; readonly normalized: string },
): string | null {
  const machineKindIssue = grblSettingCommandMachineKindIssue(
    machineKindOf(useStore.getState().project.machine),
    command.normalized,
  );
  if (machineKindIssue !== null) return machineKindIssue;
  if (command.kind !== 'setting-write' || driver.capabilities.settings === 'grbl-dollar') {
    return null;
  }
  return `${driver.label} does not accept numeric $ setting writes from the app. Configure the controller with its own tools.`;
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

function trackConsoleWcsSelection(set: SetFn, normalized: string): void {
  const wcsSelection = consoleWcsSelection(normalized);
  if (wcsSelection !== null) set({ activeWcs: wcsSelection });
}

// The last G54-G59 word in a console command is the WCS it leaves active. GRBL
// status never reports which WCS is active, so this console echo is how the app
// learns the operator selected a non-G54 frame.
function consoleWcsSelection(normalized: string): ActiveWorkCoordinateSystem | null {
  const matches = normalized.toUpperCase().match(/\bG5[4-9]\b/g);
  const last = matches?.at(-1);
  return last === undefined ? null : (last as ActiveWorkCoordinateSystem);
}

function consoleStateEffectPatch(
  state: LaserState,
  effect: Exclude<ConsoleStateEffect, 'read-only'>,
  command: string,
): Partial<LaserState> {
  const observationPatch = consoleObservationPatch(state, effect, command);
  const positionPatch: Partial<LaserState> = {
    ...observationPatch,
    homingProof: null,
    frameVerification: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
  };
  switch (effect) {
    case 'machine-state':
      return positionPatch;
    case 'accessories':
    case 'non-positional':
      return observationPatch;
    case 'coordinates-xy':
      return {
        ...positionPatch,
        workOriginActive: false,
        workOriginSource: 'none',
        wcoCache: null,
      };
    case 'coordinates-z':
    case 'tool':
      return {
        ...positionPatch,
        workZZeroEvidence: null,
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
        wcoCache: null,
      };
    case 'coordinates-all':
      return {
        ...positionPatch,
        ...unknownCoordinatePatch(),
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
      };
    case 'reference':
      return {
        ...positionPatch,
        ...unknownCoordinatePatch(),
        homingState: 'unknown',
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
      };
    case 'configuration-nonpositional':
      return {
        ...observationPatch,
        ...settingsInvalidationPatch(),
      };
    case 'configuration':
      return {
        ...positionPatch,
        ...unknownCoordinatePatch(),
        homingState: 'unknown',
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
        ...settingsInvalidationPatch(),
      };
  }
}

function consoleObservationPatch(
  state: LaserState,
  effect: Exclude<ConsoleStateEffect, 'read-only'>,
  command: string,
): Partial<LaserState> {
  return {
    // A serial write is not proof that buffered motion or modal mutation has
    // physically completed. Require a fresh controller report before another
    // setup/job action can trust Idle, but preserve unrelated position proof.
    statusReport: null,
    statusObservation: null,
    ...(hasAccessoryCommand(command)
      ? { accessoryCache: invalidateAccessoryObservation(state.accessoryCache) }
      : {}),
    log: pushLog(
      state,
      `[lf2] Console ${stateEffectLabel(effect)} invalidated cached machine/setup evidence: ${command}`,
    ),
  };
}

function settingsInvalidationPatch(): Partial<LaserState> {
  return {
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  };
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
    case 'accessories':
      return 'accessory command';
    case 'non-positional':
      return 'non-positional command';
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
    case 'configuration-nonpositional':
      return 'non-positional configuration command';
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
