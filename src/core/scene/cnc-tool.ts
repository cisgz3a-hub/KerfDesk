// CNC tool identity and load-bearing cutter geometry. `kind` deliberately
// stays small: the CAM and removal simulator understand these shapes, while
// flute direction and product family are descriptive catalog metadata.

export type CncToolKind = 'end-mill' | 'ball-nose' | 'v-bit' | 'engraving' | 'tapered-ball-nose';

export type CncTool = {
  readonly id: string;
  readonly name: string;
  readonly kind: CncToolKind;
  // Cut diameter. For an angled or tapered cutter this is the widest cutting
  // diameter, where the flank ends, not the tip size.
  readonly diameterMm: number;
  // v-bit / engraving / tapered-ball-nose tools only: included angle. A
  // tapered ball nose stores twice the per-side taper sellers list (ADR-368).
  readonly tipAngleDeg?: number;
  // Engraving tools: the flat land at the very tip. A conical engraving
  // bit is a TRUNCATED cone — flat for this diameter, then conical flanks at
  // tipAngleDeg — unlike a v-bit, which comes to a point. Absent or 0 means a
  // true point, which is how legacy hand-entered tools behave.
  // Tapered-ball-nose tools: the diameter of the ball at the tip (twice the
  // listed tip radius), which meets the taper tangentially. Required there.
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
