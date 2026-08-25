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
// s_row = 2·sqrt(c·(2r − c)). The emitted stride is the largest whole number
// of sampled rows no greater than that request. The CNC compiler materializes
// an exact grid no coarser than that spacing; for an externally supplied coarser
// map, one row is irreducible and the requested scallop is not qualified.
// Flat bits use the established fixed fraction of their diameter. Rows
// alternate direction (serpentine).

import type { ToolKernel } from '../sim';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { partialCellCenter } from '../grid';
import { dilateHeightmapByToolWithMaskEvidence } from './heightmap-tool-offset';
import type { Heightmap } from './heightmap';

export const DEFAULT_RELIEF_SCALLOP_MM = 0.025;
const FLAT_TOOL_STEPOVER_FRACTION = 0.4;
const MIN_FLAT_ROW_SPACING_MM = 0.05;

export type ReliefFinishingOptions = {
  readonly tool: CncTool;
  readonly kernel: ToolKernel;
  readonly scallopMm: number;
};

type FinishingPoint = { readonly x: number; readonly y: number; readonly z: number };

export function reliefFinishingPasses(
  map: Heightmap,
  options: ReliefFinishingOptions,
): ReadonlyArray<CncPass> {
  const { widthCells, heightCells, mmPerCell } = map;
  if (widthCells < 1 || heightCells < 1) return [];
  const dilation = dilateHeightmapByToolWithMaskEvidence(map, options.kernel, 0);
  const tip = dilation.tipDepth;
  const rowSpacingMm = scallopRowSpacingMm(options.tool, options.scallopMm);
  const rowStep = Math.max(1, Math.floor(rowSpacingMm / mmPerCell));
  if (map.inclusion !== undefined) {
    return maskedFinishingPasses(map, tip, rowStep, map.inclusion, dilation.touchesExcluded);
  }

  // Row indices at the scallop stride, plus the far-Y row whenever the stride
  // steps over it — otherwise the last rowStep-1 rows keep their roughing
  // allowance as an uncut ridge along the far edge. surfacingRowYs solves the
  // same problem the same way by pushing the far edge after its loop.
  const rows: number[] = [];
  for (let row = 0; row < heightCells; row += rowStep) rows.push(row);
  const farRow = heightCells - 1;
  if (rows[rows.length - 1] !== farRow) rows.push(farRow);

  const passes: CncPass[] = [];
  let leftToRight = true;
  for (const row of rows) {
    const y = partialCellCenter(map, 'y', row);
    let points: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < widthCells; i += 1) {
      const col = leftToRight ? i : widthCells - 1 - i;
      const index = row * widthCells + col;
      if (map.inclusion?.[index] === 0) {
        appendFinishingRun(passes, points);
        points = [];
        continue;
      }
      points.push({
        x: partialCellCenter(map, 'x', col),
        y,
        z: tip[index] ?? 0,
      });
    }
    appendFinishingRun(passes, points);
    leftToRight = !leftToRight;
  }
  return passes;
}

function maskedFinishingPasses(
  map: Heightmap,
  tip: Float32Array,
  rowStep: number,
  inclusion: Uint8Array,
  touchesExcluded: Uint8Array | undefined,
): ReadonlyArray<CncPass> {
  const selected = selectMaskedFinishingCells(map, inclusion, rowStep);
  const passes: CncPass[] = [];
  let leftToRight = true;
  for (let row = 0; row < map.heightCells; row += 1) {
    if (!rowHasSelection(selected, row, map.widthCells)) continue;
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
    passes.push({ kind: 'path3d', points, closed: false });
    return;
  }
  const point = points[0];
  if (point !== undefined && point.z < 0) {
    passes.push({ kind: 'path3d', points: [{ ...point, z: 0 }, point], closed: false });
  }
}

export function scallopRowSpacingMm(tool: CncTool, scallopMm: number): number {
  if (tool.kind === 'ball-nose') {
    const radius = tool.diameterMm / 2;
    const scallop = Math.min(Math.max(scallopMm, 0.001), radius);
    return 2 * Math.sqrt(scallop * (2 * radius - scallop));
  }
  return Math.max(MIN_FLAT_ROW_SPACING_MM, tool.diameterMm * FLAT_TOOL_STEPOVER_FRACTION);
}
