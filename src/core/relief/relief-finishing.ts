// reliefFinishingPasses — the H.8 finishing skim (ADR-098). After H.5
// roughing leaves its fixed allowance, the finishing bit rides the TRUE
// surface: serpentine rows of per-vertex XYZ motion whose Z at every sampled
// grid point is the max-plus tip surface — dilateHeightmapByTool with ZERO
// allowance. Ball-nose samples follow their sphere profile via the tool
// kernel. Excluded-mask chords use a whole-cell emitted-precision envelope;
// interpolation over included subcell surface features retains ADR-289's
// explicit qualification boundary.
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
// (relief-finishing-path.ts).

import type { ToolKernel } from '../sim';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { taperedBallEnvelope } from '../cnc-tapered-ball';
import { partialCellCenter } from '../grid';
import { dilateHeightmapByToolWithMaskEvidence } from './heightmap-tool-offset';
import type { Heightmap } from './heightmap';
import { reduceFinishingPath, type FinishingPoint } from './relief-finishing-path';

export const DEFAULT_RELIEF_SCALLOP_MM = 0.025;
const FLAT_TOOL_STEPOVER_FRACTION = 0.4;
const MIN_FLAT_ROW_SPACING_MM = 0.05;
// A compiler grid sized to a whole number of rows (ADR-421) must not lose a
// row to the rounding of rowSpacing / mmPerCell.
const ROW_STRIDE_RELATIVE_SLACK = 1e-9;

export type ReliefFinishingOptions = {
  readonly tool: CncTool;
  readonly kernel: ToolKernel;
  readonly scallopMm: number;
};

export function reliefFinishingPasses(
  map: Heightmap,
  options: ReliefFinishingOptions,
): ReadonlyArray<CncPass> {
  const { widthCells, heightCells, mmPerCell } = map;
  if (widthCells < 1 || heightCells < 1) return [];
  const rowSpacingMm = scallopRowSpacingMm(options.tool, options.scallopMm);
  const rowStep = finishingRowStep(rowSpacingMm, mmPerCell);
  if (map.inclusion !== undefined && map.inclusion.includes(0)) {
    const selected = selectMaskedFinishingCells(map, map.inclusion, rowStep);
    const rows = maskedRows(map, selected);
    const dilation = dilateHeightmapByToolWithMaskEvidence(map, options.kernel, 0, {
      rows: rowFlags(heightCells, rows),
    });
    return maskedFinishingPasses(map, dilation.tipDepth, rows, selected, dilation.touchesExcluded);
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
  const tip = dilateHeightmapByToolWithMaskEvidence(unmasked, options.kernel, 0, {
    rows: rowFlags(heightCells, rows),
    columns: edgeColumns,
  }).tipDepth;
  const passes: CncPass[] = [];
  appendFinishingRun(passes, linkedSerpentine(map, tip, rows));
  return passes;
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

function maskedFinishingPasses(
  map: Heightmap,
  tip: Float32Array,
  rows: ReadonlyArray<number>,
  selected: Uint8Array,
  touchesExcluded: Uint8Array | undefined,
): ReadonlyArray<CncPass> {
  const passes: CncPass[] = [];
  let leftToRight = true;
  for (const row of rows) {
    appendMaskedFinishingRow(passes, map, tip, row, leftToRight, selected, touchesExcluded);
    leftToRight = !leftToRight;
  }
  return passes;
}

function appendMaskedFinishingRow(
  passes: CncPass[],
  map: Heightmap,
  tip: Float32Array,
  row: number,
  leftToRight: boolean,
  selected: Uint8Array,
  touchesExcluded: Uint8Array | undefined,
): void {
  const y = partialCellCenter(map, 'y', row);
  let points: FinishingPoint[] = [];
  for (let i = 0; i < map.widthCells; i += 1) {
    const col = leftToRight ? i : map.widthCells - 1 - i;
    const index = row * map.widthCells + col;
    if (selected[index] === 0 || touchesExcluded?.[index] !== 0) {
      appendFinishingRun(passes, points);
      points = [];
      if (selected[index] !== 0) {
        appendFinishingRun(passes, [
          { x: partialCellCenter(map, 'x', col), y, z: tip[index] ?? 0 },
        ]);
      }
      continue;
    }
    points.push({ x: partialCellCenter(map, 'x', col), y, z: tip[index] ?? 0 });
  }
  appendFinishingRun(passes, points);
}

// Give every contiguous vertical mask run the unchanged sampled stride plus
// its far edge. A narrow lobe therefore cannot disappear merely because it is
// attached to a taller component whose global row phase steps past the lobe.
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
  let lastSelected = startRow;
  for (let row = startRow; row <= endRow; row += rowStep) {
    selected[row * widthCells + col] = 1;
    lastSelected = row;
  }
  if (lastSelected !== endRow) selected[endRow * widthCells + col] = 1;
}

function rowHasSelection(selected: Uint8Array, row: number, widthCells: number): boolean {
  const end = (row + 1) * widthCells;
  for (let index = row * widthCells; index < end; index += 1) {
    if (selected[index] !== 0) return true;
  }
  return false;
}

function appendFinishingRun(passes: CncPass[], points: ReadonlyArray<FinishingPoint>): void {
  if (points.length >= 2) {
    passes.push({
      kind: 'path3d',
      points: reduceFinishingPath(points),
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
