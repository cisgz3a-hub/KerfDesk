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
  const cell = gridCellSize(bounds, spec.randomRotation);
  return {
    stepX: cell.width + finiteNonNegative(spec.spacingX),
    stepY: cell.height + finiteNonNegative(spec.spacingY),
  };
}

/**
 * The room one copy can take up, across and down. A copy turned at random
 * about its centre may stand either way round, so an edge gap is measured from
 * the box any of its turns fits: quarter turns swap width and height, and any
 * other angle needs the diagonal. Half turns change nothing.
 */
export function gridCellSize(
  bounds: Bounds,
  randomRotation: GridArraySpec['randomRotation'],
): { readonly width: number; readonly height: number } {
  const width = span(bounds.minX, bounds.maxX);
  const height = span(bounds.minY, bounds.maxY);
  if (randomRotation === undefined) return { width, height };
  const step = finiteNonNegative(randomRotation.stepDeg);
  if (step > 0 && step % 180 === 0) return { width, height };
  const side = step > 0 && step % 90 === 0 ? Math.max(width, height) : Math.hypot(width, height);
  return { width: side, height: side };
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
  const turns = spec.randomRotation === undefined ? () => 0 : randomTurns(spec.randomRotation);
  const placements: ArrayPlacement[] = [];
  for (let index = 0; index < copyCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const oddRow = row % 2 === 1;
    const oddColumn = column % 2 === 1;
    // Adding the (zero) shift also turns a reversed first column's -0 into 0.
    const mirror = gridMirror(spec, oddColumn, oddRow, center);
    const dx = column * stepX * signX + (oddRow ? rowShift : 0);
    const dy = row * stepY * signY + (oddColumn ? columnShift : 0);
    placements.push({
      dx,
      dy,
      ...turnAbout(index === 0 ? 0 : turns(), { x: center.x + dx, y: center.y + dy }),
      ...(mirror === undefined ? {} : { mirror }),
    });
  }
  return placements;
}

function turnAbout(
  rotationDeg: number,
  pivot: { readonly x: number; readonly y: number },
): Pick<ArrayPlacement, 'rotationDeg' | 'pivot'> {
  return rotationDeg === 0 ? { rotationDeg } : { rotationDeg, pivot };
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

// Mulberry32: a small seeded generator, so a seed always gives the same turns.
function randomTurns(settings: NonNullable<GridArraySpec['randomRotation']>): () => number {
  let state = Math.trunc(finite(settings.seed)) >>> 0;
  const step = finiteNonNegative(settings.stepDeg);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    if (step <= 0) return unit * 360;
    const slots = Math.max(1, Math.round(360 / step));
    return (Math.floor(unit * slots) % slots) * step;
  };
}
