export type ControllerObservationStamp = {
  readonly sessionEpoch: number;
  readonly positionEpoch: number;
  readonly sequence: number;
  readonly observedAt: number;
};

export type SessionObservationStamp = {
  readonly sessionEpoch: number;
  readonly observedAt: number;
};

export type HomingProof = {
  readonly sessionEpoch: number;
  readonly positionEpoch: number;
  readonly confirmedStatusSequence: number;
};
