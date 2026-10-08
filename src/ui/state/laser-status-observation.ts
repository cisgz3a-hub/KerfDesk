import type { LaserState } from './laser-store';

export function statusObservationPatch(
  state: LaserState,
  sequence: number,
  positionInvalidated: boolean,
): Pick<LaserState, 'statusObservation' | 'statusResponseObservation'> {
  return {
    ...statusResponseObservationPatch(state),
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

export function statusResponseObservationPatch(
  state: LaserState,
): Pick<LaserState, 'statusResponseObservation'> {
  return {
    statusResponseObservation: {
      sessionEpoch: state.controllerSessionEpoch,
      observedAt: Date.now(),
    },
  };
}
