import type { LaserState } from './laser-store';
import { qualifyingController } from './laser-controller-qualification';

export function invalidateControllerSessionEvidence(state: LaserState): Partial<LaserState> {
  const nextEpoch = state.controllerSessionEpoch + 1;
  return {
    controllerSessionEpoch: nextEpoch,
    statusReport: null,
    statusObservation: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerQualification: qualifyingController(nextEpoch, 'reset-cleanup'),
    detectedSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    homingState: 'unknown',
    homingProof: null,
  };
}
