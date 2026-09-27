// reliefFinishingPasses — the H.8 finishing skim (ADR-098). After H.5
// roughing leaves its fixed allowance, the finishing bit rides the TRUE
// surface: serpentine rows of per-vertex XYZ motion whose Z at every sampled
// grid point is the max-plus tip surface — dilateHeightmapByTool with ZERO
// allowance. Ball-nose samples follow their sphere profile via the tool
// kernel. A masked raster's rows run through every selected sample, their
// runs are linked nearest first across short gaps, and each move is checked
// exactly against the whole-cell blocks of excluded stock and lifted where it
// would dip into them (ADR-482, relief-mask-stock-path.ts); interpolation over
// included subcell surface features retains ADR-289's explicit qualification
// boundary.
//
// Requested row spacing is scallop-driven for ball noses: a ball of radius r
// stepping s_row leaves planar ridges of height c with
// s_row = 2·sqrt(c·(2r − c)). A tapered ball nose uses its TIP ball radius:
// its flank lies below that sphere's continuation beyond the tangent point,
// so the planar ridge can only be lower than requested (ADR-368). The emitted
// stride is the largest whole number of sampled rows no greater than that
// request. The CNC compiler sizes its grid so that request is a whole number of
// rows (ADR-421); for an externally supplied coarser map, one row is
// irreducible and the requested scallop is not qualified.
// Flat bits use the established fixed fraction of their diameter. Rows
// alternate direction (serpentine). Without a mask, the rows are linked along
// their shared edge column into one stay-down path; every path loses the
// vertices a straight segment can replace without cutting lower
// (relief-finishing-path.ts). Where roughing finished flats with an end mill
// (ADR-450), an unmasked raster skips them (relief-finishing-skip.ts).

import type { ToolKernel } from '../sim';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { taperedBallEnvelope } from '../cnc-tapered-ball';
import { partialCellCenter } from '../grid';
import {
  dilateHeightmapByTool,
  dilateHeightmapByToolWithMaskEvidence,
} from './heightmap-tool-offset';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';
import {
  FINISHING_REDUCTION_TOLERANCE_MM,
  reduceFinishingPath,
  type FinishingPoint,
} from './relief-finishing-path';
import { createMaskStock, type MaskStock, raisedOverStock } from './relief-mask-stock';
import { stockCheckedPath } from './relief-mask-stock-path';
import {
  finishedSkipFlags,
  linkFinishingRuns,
  type FinishingGrid,
  type FinishingRun,
} from './relief-finishing-skip';

export const DEFAULT_RELIEF_SCALLOP_MM = 0.025;
const FLAT_TOOL_STEPOVER_FRACTION = 0.4;
const MIN_FLAT_ROW_SPACING_MM = 0.05;
// A compiler grid sized to a whole number of rows (ADR-421) must not lose a
// row to the rounding of rowSpacing / mmPerCell.
const ROW_STRIDE_RELATIVE_SLACK = 1e-9;
// Longest stay-down link between the runs of a raster that skips finished
// flats, in bit diameters (ADR-450).
const SKIP_LINK_DIAMETERS = 4;

export type ReliefFinishingOptions = {
  readonly tool: CncTool;
  readonly kernel: ToolKernel;
  readonly scallopMm: number;
  // Row spacing to plan instead of the scallop's (ADR-423 narrows it).
  readonly rowSpacingMm?: number;
  // The whole zero-allowance tip surface of an unmasked map, when the caller
  // already has it (ADR-423); otherwise only the rows read are computed.
  readonly tip?: Float32Array;
  // ADR-450: the height roughing's flat levels cut (x, y) to, or NaN.
  readonly finishedAt?: (x: number, y: number) => number;
};

export function reliefFinishingPasses(
  map: Heightmap,
  options: ReliefFinishingOptions,
): ReadonlyArray<CncPass> {
  const { widthCells, heightCells, mmPerCell } = map;
  if (widthCells < 1 || heightCells < 1) return [];
  const rowSpacingMm = options.rowSpacingMm ?? scallopRowSpacingMm(options.tool, options.scallopMm);
  const rowStep = finishingRowStep(rowSpacingMm, mmPerCell);
  if (map.inclusion !== undefined && map.inclusion.includes(0)) {
    const selected = selectMaskedFinishingCells(map, map.inclusion, rowStep);
    const rows = maskedRows(map, selected);
    const dilated = dilateHeightmapByTool(map, options.kernel, 0, {
      rows: rowFlags(heightCells, rows),
    });
    const stock = createMaskStock(
      map,
      options.kernel,
      options.kernel.maskPathUncertaintyMm,
      FINISHING_REDUCTION_TOLERANCE_MM,
    );
    const tip = stock === null ? dilated : raisedOverStock(map, dilated, stock);
    return maskedFinishingPasses(map, maskedRuns(map, tip, rows, selected), stock, options);
  }

  // Row indices at the scallop stride, plus the far-Y row whenever the stride
  // steps over it — otherwise the last rowStep-1 rows keep their roughing
  // allowance as an uncut ridge along the far edge. surfacingRowYs solves the
  // same problem the same way by pushing the far edge after its loop.
  const rows: number[] = [];
  for (let row = 0; row < heightCells; row += rowStep) rows.push(row);
  const farRow = heightCells - 1;
  if (rows[rows.length - 1] !== farRow) rows.push(farRow);
  // Only emitted rows and the edge columns that link them are read, so only
  // they are computed (ADR-421).
  const edgeColumns = new Uint8Array(widthCells);
  edgeColumns[0] = 1;
  edgeColumns[widthCells - 1] = 1;
  // A mask that excludes nothing plans exactly as no mask.
  const { inclusion: _allIncluded, ...unmasked } = map;
  const tip =
    options.tip ??
    dilateHeightmapByToolWithMaskEvidence(unmasked, options.kernel, 0, {
      rows: rowFlags(heightCells, rows),
      columns: edgeColumns,
    }).tipDepth;
  return unmaskedPasses(unmasked, tip, rows, options);
}

// One linked serpentine, or where roughing finished flats (ADR-450) the runs
// the raster keeps.
function unmaskedPasses(
  map: Heightmap,
  tip: Float32Array,
  rows: ReadonlyArray<number>,
  options: ReliefFinishingOptions,
): ReadonlyArray<CncPass> {
  const passes: CncPass[] = [];
  const skip =
    options.finishedAt === undefined
      ? null
      : finishedSkipFlags(
          finishingGrid(map),
          options.finishedAt,
          rows,
          options.kernel.radiusMm,
          map.mmPerCell,
        );
  if (skip === null || !skip.includes(1)) {
    appendFinishingRun(passes, linkedSerpentine(map, tip, rows));
    return passes;
  }
  for (const chain of skippingRaster(map, tip, rows, skip, options)) {
    appendFinishingRun(passes, chain);
  }
  return passes;
}

// ADR-450: the rows' kept runs, nearest first, linked across short gaps.
function skippingRaster(
  map: Heightmap,
  tip: Float32Array,
  rows: ReadonlyArray<number>,
  skip: Uint8Array,
  options: ReliefFinishingOptions,
): ReadonlyArray<ReadonlyArray<FinishingPoint>> {
  const runs: FinishingRun[] = [];
  for (const row of rows) {
    let points: FinishingPoint[] = [];
    for (let col = 0; col <= map.widthCells; col += 1) {
      if (col < map.widthCells && skip[row * map.widthCells + col] === 0) {
        points.push(finishingSample(map, tip, col, row));
      } else if (points.length > 0) {
        runs.push({ row, points });
        points = [];
      }
    }
  }
  const contact = createSurfaceContactField(map, options.kernel);
  return linkFinishingRuns(
    runs,
    (row) => partialCellCenter(map, 'y', row),
    { tipAt: (x, y, lowerBound) => contact?.constraintAtPoint(x, y, lowerBound) ?? 0 },
    {
      maxLinkMm: SKIP_LINK_DIAMETERS * options.tool.diameterMm,
      checkSpacingMm: map.mmPerCell / 4,
    },
  );
}

function finishingGrid(map: Heightmap): FinishingGrid {
  return {
    widthCells: map.widthCells,
    heightCells: map.heightCells,
    depth: map.depth,
    centerX: (col) => partialCellCenter(map, 'x', col),
    centerY: (row) => partialCellCenter(map, 'y', row),
  };
}

// The planned row stride, in whole sampled rows, no wider than the request.
export function finishingRowStep(rowSpacingMm: number, mmPerCell: number): number {
  return Math.max(1, Math.floor((rowSpacingMm / mmPerCell) * (1 + ROW_STRIDE_RELATIVE_SLACK)));
}

// ADR-421: one stay-down serpentine. Row k ends on the edge column where row
// k + 1 starts, and the link between them follows that column's tip samples.
function linkedSerpentine(
  map: Heightmap,
  tip: Float32Array,
  rows: ReadonlyArray<number>,
): ReadonlyArray<FinishingPoint> {
  const { widthCells } = map;
  const points: FinishingPoint[] = [];
  let leftToRight = true;
  let previousRow = -1;
  for (const row of rows) {
    const edge = leftToRight ? 0 : widthCells - 1;
    for (let link = previousRow + 1; previousRow >= 0 && link < row; link += 1) {
      points.push(finishingSample(map, tip, edge, link));
    }
    for (let i = 0; i < widthCells; i += 1) {
      points.push(finishingSample(map, tip, leftToRight ? i : widthCells - 1 - i, row));
    }
    previousRow = row;
    leftToRight = !leftToRight;
  }
  return points;
}

function finishingSample(
  map: Heightmap,
  tip: Float32Array,
  col: number,
  row: number,
): FinishingPoint {
  return {
    x: partialCellCenter(map, 'x', col),
    y: partialCellCenter(map, 'y', row),
    z: tip[row * map.widthCells + col] ?? 0,
  };
}

function rowFlags(heightCells: number, rows: ReadonlyArray<number>): Uint8Array {
  const flags = new Uint8Array(heightCells);
  for (const row of rows) flags[row] = 1;
  return flags;
}

function maskedRows(map: Heightmap, selected: Uint8Array): ReadonlyArray<number> {
  const rows: number[] = [];
  for (let row = 0; row < map.heightCells; row += 1) {
    if (rowHasSelection(selected, row, map.widthCells)) rows.push(row);
  }
  return rows;
}

// The masked rows' runs, linked nearest first across short gaps as ADR-450
// links a skipping raster's; every hop, like every move, is then checked
// against the excluded stock (ADR-482).
function maskedFinishingPasses(
  map: Heightmap,
  runs: ReadonlyArray<FinishingRun>,
  stock: MaskStock | null,
  options: ReliefFinishingOptions,
): ReadonlyArray<CncPass> {
  const contact = createSurfaceContactField(map, options.kernel);
  const tipAt = (x: number, y: number, lowerBound: number): number =>
    Math.max(
      contact?.constraintAtPoint(x, y, lowerBound) ?? lowerBound,
      stock?.tipAt(x, y) ?? lowerBound,
    );
  const passes: CncPass[] = [];
  const chains = linkFinishingRuns(
    runs,
    (row) => partialCellCenter(map, 'y', row),
    { tipAt },
    {
      maxLinkMm: SKIP_LINK_DIAMETERS * options.tool.diameterMm,
      checkSpacingMm: map.mmPerCell / 4,
    },
  );
  for (const chain of chains) appendFinishingRun(passes, chain, stock);
  return passes;
}

// Per row, each run of neighbouring selected samples that stand below stock
// top, left to right: one the stock beside the mask holds at or above it cuts
// nothing.
function maskedRuns(
  map: Heightmap,
  tip: Float32Array,
  rows: ReadonlyArray<number>,
  selected: Uint8Array,
): ReadonlyArray<FinishingRun> {
  const runs: FinishingRun[] = [];
  for (const row of rows) {
    let points: FinishingPoint[] = [];
    for (let col = 0; col <= map.widthCells; col += 1) {
      const index = row * map.widthCells + col;
      if (col < map.widthCells && selected[index] !== 0 && (tip[index] ?? 0) < 0) {
        points.push(finishingSample(map, tip, col, row));
      } else if (points.length > 0) {
        runs.push({ row, points });
        points = [];
      }
    }
  }
  return runs;
}

// Give every contiguous vertical mask run the raster's rows (every rowStep-th
// row, the phase an unmasked raster uses) plus both its ends, so no two of
// its selected samples lie more than a stride apart. A narrow lobe therefore
// cannot disappear merely because the global row phase steps past it. One
// phase for every run keeps a row's selected samples side by side, so they
// run together instead of each plunging alone (ADR-482).
// Selecting cells by column also permits one global O(width*height) row scan;
// adversarial checkerboards never multiply full-width scans by component count.
function selectMaskedFinishingCells(
  map: Heightmap,
  inclusion: Uint8Array,
  rowStep: number,
): Uint8Array {
  const selected = new Uint8Array(map.widthCells * map.heightCells);
  for (let col = 0; col < map.widthCells; col += 1) {
    let row = 0;
    while (row < map.heightCells) {
      while (row < map.heightCells && inclusion[row * map.widthCells + col] === 0) row += 1;
      if (row >= map.heightCells) break;
      const start = row;
      while (row + 1 < map.heightCells && inclusion[(row + 1) * map.widthCells + col] !== 0) {
        row += 1;
      }
      selectVerticalRun(selected, map.widthCells, col, start, row, rowStep);
      row += 1;
    }
  }
  return selected;
}

function selectVerticalRun(
  selected: Uint8Array,
  widthCells: number,
  col: number,
  startRow: number,
  endRow: number,
  rowStep: number,
): void {
  selected[startRow * widthCells + col] = 1;
  for (let row = Math.ceil(startRow / rowStep) * rowStep; row <= endRow; row += rowStep) {
    selected[row * widthCells + col] = 1;
  }
  selected[endRow * widthCells + col] = 1;
}

function rowHasSelection(selected: Uint8Array, row: number, widthCells: number): boolean {
  const end = (row + 1) * widthCells;
  for (let index = row * widthCells; index < end; index += 1) {
    if (selected[index] !== 0) return true;
  }
  return false;
}

function appendFinishingRun(
  passes: CncPass[],
  points: ReadonlyArray<FinishingPoint>,
  stock: MaskStock | null = null,
): void {
  if (points.length >= 2) {
    const reduced = reduceFinishingPath(points);
    passes.push({
      kind: 'path3d',
      // Reduced first: the reduction keeps to the samples, not the stock.
      points: stock === null ? reduced : stockCheckedPath(reduced, stock),
      closed: false,
      lateralFeed: 'z-rate-capped',
    });
    return;
  }
  const point = points[0];
  if (point !== undefined && point.z < 0) {
    passes.push({
      kind: 'path3d',
      points: [{ ...point, z: 0 }, point],
      closed: false,
      lateralFeed: 'z-rate-capped',
    });
  }
}

export function scallopRowSpacingMm(tool: CncTool, scallopMm: number): number {
  const radius = reliefScallopBallRadiusMm(tool);
  if (radius !== null) {
    const scallop = Math.min(Math.max(scallopMm, 0.001), radius);
    return 2 * Math.sqrt(scallop * (2 * radius - scallop));
  }
  return Math.max(MIN_FLAT_ROW_SPACING_MM, tool.diameterMm * FLAT_TOOL_STEPOVER_FRACTION);
}

/**
 * The ball that governs finishing cusps: the whole cutter for a ball nose, the
 * tip ball for a tapered ball nose, and none for a flat or pointed cutter. A
 * tapered ball nose with invalid tip data has no ball; it plans as the flat
 * cylinder its kernel falls back to.
 */
export function reliefScallopBallRadiusMm(tool: CncTool): number | null {
  if (tool.kind === 'ball-nose') return tool.diameterMm / 2;
  if (tool.kind === 'tapered-ball-nose') return taperedBallEnvelope(tool)?.ballRadiusMm ?? null;
  return null;
}
