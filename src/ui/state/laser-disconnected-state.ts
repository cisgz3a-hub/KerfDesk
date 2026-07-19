import { disconnectedControllerQualification } from './laser-controller-qualification';
import type { LaserState } from './laser-store';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import { emptyControllerBuildInfoState } from './laser-controller-build-info';

export function disconnectedStatePatch(state: LaserState): Partial<LaserState> {
  return {
    connection: { kind: 'disconnected' },
    serialPortInfo: null,
    statusReport: null,
    controllerSessionEpoch: state.controllerSessionEpoch + 1,
    statusObservation: null,
    detectedSettings: null,
    detectedControllerKind: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    ...emptyControllerBuildInfoState(),
    controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch + 1),
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    streamer: null,
    airAssistOn: false,
    fireActive: false,
    wcoCache: null,
    accessoryCache: null,
    mpgActive: null,
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    frameVerification: null,
    framedRun: null,
    motionOperation: null,
    controllerOperation: null,
    probeBusy: false,
    homingState: 'unknown',
    homingProof: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    lastWriteError: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    ...liveCanvasLifecyclePatch(state, 'disconnected'),
  };
}
