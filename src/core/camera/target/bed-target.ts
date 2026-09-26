// Layout of the engraved bed target (ADR-441): a grid of rings across the
// area the camera should cover, with three anchors (solid discs of the ring's
// size) forming an L at the grid's middle. The anchors fix which ring is which from
// any one photo without a click: the corner of the L is the origin anchor, the
// short arm (one step) points along +x and the long arm (two steps) along +y.
// Unequal arms also expose a mirrored camera image, which an equal L cannot. The laser engraves the target at exact
// machine coordinates, so the same marks calibrate the lens and place the
// camera on the bed in one step. Pure core.

export type BedTargetArea = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type BedTargetOptions = {
  readonly area: BedTargetArea;
  /** Centre-to-centre spacing of the rings, mm. */
  readonly spacingMm?: number;
  /** Outer ring diameter, mm. */
  readonly ringDiameterMm?: number;
};

export type BedTargetMark = {
  /** Grid index relative to the origin anchor (0, 0). */
  readonly col: number;
  readonly row: number;
  /** Centre in bed mm. */
  readonly x: number;
  readonly y: number;
  readonly anchor: boolean;
};

export type BedTargetLayout = {
  readonly marks: ReadonlyArray<BedTargetMark>;
  readonly spacingMm: number;
  readonly ringDiameterMm: number;
  /** Ring stroke width (outer radius minus hole radius), mm. */
  readonly ringWidthMm: number;
};

export const DEFAULT_TARGET_SPACING_MM = 40;
export const DEFAULT_RING_DIAMETER_MM = 10;
const RING_WIDTH_SHARE = 0.18;
// Keep every ring fully inside the area.
const EDGE_CLEARANCE_SHARE = 0.75;

export function bedTargetLayout(options: BedTargetOptions): BedTargetLayout {
  const spacing = options.spacingMm ?? DEFAULT_TARGET_SPACING_MM;
  const diameter = options.ringDiameterMm ?? DEFAULT_RING_DIAMETER_MM;
  const { area } = options;
  const clearance = diameter * EDGE_CLEARANCE_SHARE;
  const cols = Math.max(3, Math.floor((area.width - 2 * clearance) / spacing) + 1);
  const rows = Math.max(4, Math.floor((area.height - 2 * clearance) / spacing) + 1);
  const x0 = area.x + (area.width - (cols - 1) * spacing) / 2;
  const y0 = area.y + (area.height - (rows - 1) * spacing) / 2;
  // Origin anchor near the middle, with room for both arms of the L.
  const originCol = Math.min(Math.floor((cols - 1) / 2), cols - 2);
  const originRow = Math.min(Math.floor((rows - 1) / 2), rows - 3);
  const marks: BedTargetMark[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const col = c - originCol;
      const row = r - originRow;
      marks.push({
        col,
        row,
        x: x0 + c * spacing,
        y: y0 + r * spacing,
        anchor: (col === 0 && row === 0) || (col === 1 && row === 0) || (col === 0 && row === 2),
      });
    }
  }
  return {
    marks,
    spacingMm: spacing,
    ringDiameterMm: diameter,
    ringWidthMm: diameter * RING_WIDTH_SHARE,
  };
}

/** The mark at grid index (col, row), if the layout has one. */
export function markAt(
  layout: BedTargetLayout,
  col: number,
  row: number,
): BedTargetMark | undefined {
  return layout.marks.find((m) => m.col === col && m.row === row);
}
