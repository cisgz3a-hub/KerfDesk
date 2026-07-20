import type { LaserState } from './laser-store';
import { qualifyingController } from './laser-controller-qualification';
import { emptyControllerBuildInfoState } from './laser-controller-build-info';

export function invalidateControllerSessionEvidence(state: LaserState): Partial<LaserState> {
  const nextEpoch = state.controllerSessionEpoch + 1;
  return {
    controllerSessionEpoch: nextEpoch,
    statusReport: null,
    statusObservation: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    ...emptyControllerBuildInfoState(),
    controllerQualification: qualifyingController(nextEpoch, 'reset-cleanup'),
    detectedSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    homingState: 'unknown',
    homingProof: null,
  };
}
