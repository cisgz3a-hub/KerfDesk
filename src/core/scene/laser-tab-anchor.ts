// A click-placed laser Line tab (ADR-494). Same shape as CncTabAnchor, declared
// separately so laser and CNC tabs can change independently (ADR-101).
export type LaserTabAnchor = {
  readonly layerColor: string;
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly pathT: number;
};
