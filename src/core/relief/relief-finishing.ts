// reliefFinishingPasses — the H.8 finishing skim (ADR-098). After H.5
// roughing leaves its fixed allowance, the finishing bit rides the TRUE
// surface: serpentine rows of per-vertex XYZ motion whose Z at every sample
// is the max-plus tip surface — dilateHeightmapByTool with ZERO allowance —
// so the tip never cuts below the target anywhere under its footprint
// (ball-nose tips follow their sphere profile via the tool kernel).
//
// Row spacing is scallop-driven for ball noses: a ball of radius r stepping
// s_row leaves ridges of height c with s_row = 2·sqrt(c·(2r − c)). Flat
// bits leave no scallop; they step a fixed fraction of their diameter.
// Rows alternate direction (serpentine) so travel between rows is one cell.

import type { ToolKernel } from '../sim';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import type { Heightmap } from './heightmap';

export const DEFAULT_RELIEF_SCALLOP_MM = 0.025;
const FLAT_TOOL_STEPOVER_FRACTION = 0.4;
const MIN_ROW_SPACING_MM = 0.05;

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
  if (widthCells < 2 || heightCells < 1) return [];
  const tip = dilateHeightmapByTool(map, options.kernel, 0);
  const rowSpacingMm = scallopRowSpacingMm(options.tool, options.scallopMm);
  const rowStep = Math.max(1, Math.round(rowSpacingMm / mmPerCell));

  const passes: CncPass[] = [];
  let leftToRight = true;
  for (let row = 0; row < heightCells; row += rowStep) {
    const y = (row + 0.5) * mmPerCell;
    const points = [];
    for (let i = 0; i < widthCells; i += 1) {
      const col = leftToRight ? i : widthCells - 1 - i;
      points.push({
        x: (col + 0.5) * mmPerCell,
        y,
        z: tip[row * widthCells + col] ?? 0,
      });
    }
    passes.push({ kind: 'path3d', points, closed: false });
    leftToRight = !leftToRight;
  }
  return passes;
}

export function scallopRowSpacingMm(tool: CncTool, scallopMm: number): number {
  if (tool.kind === 'ball-nose') {
    const radius = tool.diameterMm / 2;
    const scallop = Math.min(Math.max(scallopMm, 0.001), radius);
    return Math.max(MIN_ROW_SPACING_MM, 2 * Math.sqrt(scallop * (2 * radius - scallop)));
  }
  return Math.max(MIN_ROW_SPACING_MM, tool.diameterMm * FLAT_TOOL_STEPOVER_FRACTION);
}
