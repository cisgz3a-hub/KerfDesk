// Grid array placements (ADR-307, LightBurn gap LBG-T13). Row-major from the
// original, which is always the first instance and never moves: it sits in
// row 1, column 1, which no shift or mirror touches.

import type {
  ArrayMirrorAxes,
  ArrayPlacement,
  ArrayPlacementMirror,
  GridArraySpec,
} from './array-layout-types';
import { finite, finiteNonNegative, positiveCount, span } from './array-layout-math';
import type { Bounds } from './scene-object';

/** Distance from one copy's centre to the next, across and down. */
export function gridSteps(
  bounds: Bounds,
  spec: GridArraySpec,
): { readonly stepX: number; readonly stepY: number } {
  if (spec.spaceBy === 'centres') {
    return { stepX: finiteNonNegative(spec.spacingX), stepY: finiteNonNegative(spec.spacingY) };
  }
  return {
    stepX: span(bounds.minX, bounds.maxX) + finiteNonNegative(spec.spacingX),
    stepY: span(bounds.minY, bounds.maxY) + finiteNonNegative(spec.spacingY),
  };
}

export function gridPlacements(bounds: Bounds, spec: GridArraySpec): ReadonlyArray<ArrayPlacement> {
  const rows = positiveCount(spec.rows);
  const columns = positiveCount(spec.columns);
  const copyCount = rows * columns;
  const { stepX, stepY } = gridSteps(bounds, spec);
  const signX = spec.reverseColumns === true ? -1 : 1;
  const signY = spec.reverseRows === true ? -1 : 1;
  const rowShift = finite(spec.rowShift ?? 0);
  const columnShift = finite(spec.columnShift ?? 0);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const placements: ArrayPlacement[] = [];
  for (let index = 0; index < copyCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const oddRow = row % 2 === 1;
    const oddColumn = column % 2 === 1;
    // Adding the (zero) shift also turns a reversed first column's -0 into 0.
    const mirror = gridMirror(spec, oddColumn, oddRow, center);
    placements.push({
      dx: column * stepX * signX + (oddRow ? rowShift : 0),
      dy: row * stepY * signY + (oddColumn ? columnShift : 0),
      rotationDeg: 0,
      ...(mirror === undefined ? {} : { mirror }),
    });
  }
  return placements;
}

function gridMirror(
  spec: GridArraySpec,
  oddColumn: boolean,
  oddRow: boolean,
  center: ArrayPlacementMirror['center'],
): ArrayPlacementMirror | undefined {
  const columnAxes = oddColumn ? (spec.mirrorColumns ?? 'none') : 'none';
  const rowAxes = oddRow ? (spec.mirrorRows ?? 'none') : 'none';
  // Two mirrors in the same direction cancel out.
  const horizontal = mirrorsHorizontally(columnAxes) !== mirrorsHorizontally(rowAxes);
  const vertical = mirrorsVertically(columnAxes) !== mirrorsVertically(rowAxes);
  return horizontal || vertical ? { horizontal, vertical, center } : undefined;
}

function mirrorsHorizontally(axes: ArrayMirrorAxes): boolean {
  return axes === 'horizontal' || axes === 'both';
}

function mirrorsVertically(axes: ArrayMirrorAxes): boolean {
  return axes === 'vertical' || axes === 'both';
}
