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
  // Engraving tools only: the flat land at the very tip. A conical engraving
  // bit is a TRUNCATED cone — flat for this diameter, then conical flanks at
  // tipAngleDeg — unlike a v-bit, which comes to a point. Absent or 0 means a
  // true point, which is how legacy hand-entered tools behave.
  readonly tipDiameterMm?: number;
  // Descriptive taxonomy, deliberately separate from the load-bearing kind.
  // Unknown future families remain safe because CAM never branches on this.
  readonly family?: string;
  // Physical/catalog metadata. Optional for legacy and hand-entered tools.
  readonly shankDiameterMm?: number;
  readonly fluteCount?: number;
  // Stable identity of an app catalog entry copied into the custom library.
  readonly catalogId?: string;
};
