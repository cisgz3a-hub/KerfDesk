import type { LaserState } from './laser-store';

export function statusObservationPatch(
  state: LaserState,
  sequence: number,
  positionInvalidated: boolean,
): Pick<LaserState, 'statusObservation'> {
  return {
    statusObservation: positionInvalidated
      ? null
      : {
          sessionEpoch: state.controllerSessionEpoch,
          positionEpoch: state.trustedPositionEpoch ?? 0,
          sequence,
          observedAt: Date.now(),
        },
  };
}
