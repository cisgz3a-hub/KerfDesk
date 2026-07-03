// layout — deterministic flat-grid arrangement for the generated panel
// sheet (ADR-106): three columns in stable panel order, rows as tall as
// their tallest panel, partSpacingMm between neighbours. Offsets translate
// each panel's bounding box, so fitted outlines that are inset from their
// nominal face rect still sit flush in the grid.

import type { Vec2 } from '../scene';

const GRID_COLUMNS = 3;

export type PanelExtent = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Per-panel sheet translation, parallel to the input order. */
export function layoutPanelOffsets(
  extents: ReadonlyArray<PanelExtent>,
  spacingMm: number,
): ReadonlyArray<Vec2> {
  const offsets: Vec2[] = [];
  let rowTopMm = 0;
  for (let rowStart = 0; rowStart < extents.length; rowStart += GRID_COLUMNS) {
    const row = extents.slice(rowStart, rowStart + GRID_COLUMNS);
    let cursorMm = 0;
    let rowHeightMm = 0;
    for (const extent of row) {
      offsets.push({ x: cursorMm - extent.minX, y: rowTopMm - extent.minY });
      cursorMm += extent.maxX - extent.minX + spacingMm;
      rowHeightMm = Math.max(rowHeightMm, extent.maxY - extent.minY);
    }
    rowTopMm += rowHeightMm + spacingMm;
  }
  return offsets;
}
