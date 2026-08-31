import { idleCollector } from '../../core/controllers/grbl';
import type { ControllerEvent } from '../../core/controllers';
import { clearCncLiveCaps, SETTINGS_READ_OPERATION_LABEL } from './detected-settings-action';
import type { HandlerRefs, SetFn } from './laser-line-shared';
import type { LaserState } from './laser-store';

const MPG_SETTINGS_QUALIFICATION_MESSAGE =
  'Controller settings qualification was interrupted because the pendant/MPG took transport ownership. Retry the settings read after MPG:0.';

export function invalidateSettingsForMpgTakeover(
  set: SetFn,
  refs: HandlerRefs,
  state: LaserState,
  event: ControllerEvent,
): void {
  if (event.kind !== 'status' || event.report.mpgActive !== true || state.mpgActive === true)
    return;
  refs.settingsCollector = idleCollector();
  refs.settingsCollectorSessionEpoch = null;
  clearCncLiveCaps();
  set({
    detectedSettings: null,
    // Keep the last completed settings snapshot as the controller's
    // best-known reporting-unit contract. Clearing it makes every consumer
    // interpret inch-mode status positions as millimetres until the next $$
    // read, which can place an ordinary Frame 25.4x away from its real target.
    // The observation/qualification below is still invalidated, so this stale
    // snapshot cannot masquerade as freshly qualified settings.
    controllerSettingsObservation: null,
    controllerQualification: {
      kind: 'failed',
      epoch: state.controllerSessionEpoch,
      message: MPG_SETTINGS_QUALIFICATION_MESSAGE,
    },
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    ...(isSettingsReadOperation(state.controllerOperation) ? { controllerOperation: null } : {}),
  });
}

function isSettingsReadOperation(operation: LaserState['controllerOperation']): boolean {
  return (
    operation?.kind === 'interactive-command' && operation.label === SETTINGS_READ_OPERATION_LABEL
  );
}
