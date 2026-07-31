// CNC tool identity and load-bearing cutter geometry. `kind` deliberately
// stays small: the CAM and removal simulator understand these shapes, while
// flute direction and product family are descriptive catalog metadata.

export type CncToolKind = 'end-mill' | 'ball-nose' | 'v-bit' | 'engraving';

export type CncTool = {
  readonly id: string;
  readonly name: string;
  readonly kind: CncToolKind;
  readonly diameterMm: number;
  // v-bit / engraving tools only: included angle.
  readonly tipAngleDeg?: number;
};
