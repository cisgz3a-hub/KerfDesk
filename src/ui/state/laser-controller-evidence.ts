import type { LaserState } from './laser-store';

export function invalidateControllerSessionEvidence(state: LaserState): Partial<LaserState> {
  return {
    controllerSessionEpoch: state.controllerSessionEpoch + 1,
    statusReport: null,
    statusObservation: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    detectedSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    homingState: 'unknown',
    homingProof: null,
  };
}
