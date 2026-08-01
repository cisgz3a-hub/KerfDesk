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
  // Descriptive taxonomy, deliberately separate from the load-bearing kind.
  // Unknown future families remain safe because CAM never branches on this.
  readonly family?: string;
  // Physical/catalog metadata. Optional for legacy and hand-entered tools.
  readonly shankDiameterMm?: number;
  readonly fluteCount?: number;
  // Stable identity of an app catalog entry copied into the custom library.
  readonly catalogId?: string;
};
