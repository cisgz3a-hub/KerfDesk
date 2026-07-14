import type { ControllerObservationStamp, HomingProof } from './laser-controller-observation';
import type { HomingState } from './laser-store';

export type HomingProofState = {
  readonly homingState: HomingState;
  readonly controllerSessionEpoch: number;
  readonly trustedPositionEpoch?: number;
  readonly statusObservation: ControllerObservationStamp | null;
  readonly homingProof: HomingProof | null;
};

export function isCurrentHomingProof(state: HomingProofState): boolean {
  const proof = state.homingProof;
  const status = state.statusObservation;
  const positionEpoch = state.trustedPositionEpoch ?? 0;
  return (
    state.homingState === 'confirmed' &&
    proof !== null &&
    status !== null &&
    proof.sessionEpoch === state.controllerSessionEpoch &&
    proof.positionEpoch === positionEpoch &&
    status.sessionEpoch === state.controllerSessionEpoch &&
    status.positionEpoch === positionEpoch &&
    status.sequence >= proof.confirmedStatusSequence
  );
}
