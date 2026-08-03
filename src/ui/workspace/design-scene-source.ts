// computeDesignSceneSource — the CNC pane's design-time scene source: the
// removal grid AND the 3D moves that carved it, both derived from ONE
// prepareOutput call. Each step is stamped with the bit that made it (H.7
// per-layer bits), so a v-carve border reads as a v-groove even when the
// machine's active bit is a flat end mill. Display-only (ADR-261 §3): a null
// source shows a hint and gates nothing.

import { isChiploadMaterialKey } from '../../core/cnc';
import { toSceneCoords } from '../../core/devices';
import {
  activeCncTool,
  type CncMachineConfig,
  type CncTool,
  type OutputScope,
  type Project,
} from '../../core/scene';
import {
  computeRemovalGrid,
  DEFAULT_CELL_MM,
  kernelForTool,
  toolProfile,
  type RemovalGrid,
  type RemovalGridSpec,
} from '../../core/sim';
import { toolpathMoves3d } from '../../core/toolpath3d';
import { prepareOutput } from '../../io/gcode';
import { buildPreviewToolpathFromPrepared, previewPreparationIssue } from './draw-preview';
import type { PreviewToolpath } from './preview-status';
import { toolpathToolsByToolKey } from './toolpath-tools';
import type { DesignSceneSource } from './use-cnc-3d-scene';

// Coarser than the Preview grid — the pane recomputes on every edit.
// NOTE (unresolved, ADR-284): a 1.5 mm deep V-groove is only 0.80 mm wide, so
// at 500 cells across a 400 mm stock the groove is ONE cell and no amount of
// shading can make it read as a cut. Raising this is the real fix, but the
// grid is built, downsampled and meshed on the MAIN THREAD on every edit, and
// at 2000 (4M cells) that was measured to take longer than a 10 s budget in a
// browser probe. Raise it only after computeRemovalGrid moves to a worker.
const PANE_TARGET_CELLS_PER_AXIS = 500;

// Margin around the carve, so the groove's shoulder and its ambient-occlusion
// neighbourhood are inside the fine grid rather than clamped at its edge.
const DETAIL_MARGIN_MM = 3;
// Cell budget for the detail grid. Scoped to the artwork rather than the bed,
// a typical carve lands at DEFAULT_CELL_MM with far fewer cells than the
// stock-wide grid already costs.
const DETAIL_MAX_CELLS_ACROSS = 1400;

/**
 * Bounding box of the carved cells, in scene mm, or null when nothing is cut.
 *
 * Read off the coarse grid rather than the toolpath so it needs no knowledge
 * of move geometry: a cell is carved when its depth went negative.
 *
 * @param grid The stock-wide removal grid.
 * @returns The carved bounds in mm, or null when the grid is untouched.
 */
function carvedBoundsMm(
  grid: RemovalGrid,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minCol = grid.widthCells;
  let minRow = grid.heightCells;
  let maxCol = -1;
  let maxRow = -1;
  for (let row = 0; row < grid.heightCells; row += 1) {
    for (let col = 0; col < grid.widthCells; col += 1) {
      if ((grid.depth[row * grid.widthCells + col] ?? 0) >= 0) continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
  }
  if (maxCol < 0) return null;
  return {
    minX: grid.originX + minCol * grid.mmPerCell,
    minY: grid.originY + minRow * grid.mmPerCell,
    maxX: grid.originX + (maxCol + 1) * grid.mmPerCell,
    maxY: grid.originY + (maxRow + 1) * grid.mmPerCell,
  };
}

/**
 * Re-simulates just the carved region at high resolution, for shading.
 *
 * A 1.5 mm deep V-groove is 0.80 mm wide, so on a stock-wide grid it occupies
 * about one cell and arrives as a staircase of single blocks. Scoping the grid
 * to the artwork — which is what the standalone preview always did — restores
 * roughly ten cells across the same groove at a cell count no larger than the
 * stock-wide grid already pays for.
 *
 * @param toolpath The same toolpath the stock-wide grid was stamped from.
 * @param grid The stock-wide grid, used only to locate the carve.
 * @param machine The CNC machine, for the active tool.
 * @param tools Per-tool-key lookup for multi-tool jobs.
 * @returns The fine grid, or null when there is nothing carved to refine.
 */
function detailGridFor(
  toolpath: PreviewToolpath,
  grid: RemovalGrid,
  machine: CncMachineConfig,
  tools: ReadonlyMap<string, CncTool>,
): RemovalGrid | null {
  const bounds = carvedBoundsMm(grid);
  if (bounds === null) return null;
  const widthMm = bounds.maxX - bounds.minX + 2 * DETAIL_MARGIN_MM;
  const heightMm = bounds.maxY - bounds.minY + 2 * DETAIL_MARGIN_MM;
  const mmPerCell = Math.max(
    DEFAULT_CELL_MM,
    Math.max(widthMm, heightMm) / DETAIL_MAX_CELLS_ACROSS,
  );
  // No gain when the carve already fills the stock at the same density.
  if (mmPerCell >= grid.mmPerCell) return null;
  const detail = computeRemovalGrid(
    toolpath,
    {
      originX: bounds.minX - DETAIL_MARGIN_MM,
      originY: bounds.minY - DETAIL_MARGIN_MM,
      widthMm,
      heightMm,
      mmPerCell,
    },
    kernelForTool(activeCncTool(machine), mmPerCell),
    { toolsByToolKey: tools },
  );
  return detail.kind === 'ok' ? detail.grid : null;
}

/**
 * Simulates the current job for the 3D result pane: removal grid, 3D moves,
 * and the drawn bit silhouette, all in scene frame (ADR-261 §2).
 *
 * @param project The live project (the pane passes the deferred value).
 * @param outputScope The scope the 2D preview also compiles.
 * @returns The pane's scene source, or null when there is nothing to show.
 */
export function computeDesignSceneSource(
  project: Project,
  outputScope: OutputScope,
): DesignSceneSource | null {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return null;
  // Same gates as the 2D preview: over-budget scenes never reach synchronous
  // prepare on the main thread (ADR-241/ADR-243).
  if (previewPreparationIssue(project, { outputScope }) !== null) return null;
  const prepared = prepareOutput(project, { outputScope });
  if (!prepared.ok) return null;
  // buildPreviewToolpathFromPrepared maps the prepared job into scene frame,
  // which is the frame the grid below is stamped in — so the moves and the
  // surface share one frame, as ADR-261 §2 requires.
  const toolpath = buildPreviewToolpathFromPrepared(project, prepared);
  if (toolpath.totalLength <= 0) return null;
  const spec = paneGridSpec(project, machine);
  const tools = toolpathToolsByToolKey(machine, toolpath);
  const result = computeRemovalGrid(
    toolpath,
    spec,
    kernelForTool(activeCncTool(machine), spec.mmPerCell ?? DEFAULT_CELL_MM),
    { toolsByToolKey: tools },
  );
  if (result.kind !== 'ok') return null;
  const detail = detailGridFor(toolpath, result.grid, machine, tools);
  const materialKey = machine.stock.materialKey;
  return {
    grid: result.grid,
    ...(detail === null ? {} : { detailGrid: detail }),
    // materialKey is a plain string on the model, so an unrecognised key from
    // an older project file falls back to the default palette.
    ...(isChiploadMaterialKey(materialKey) ? { materialKey } : {}),
    moves: toolpathMoves3d(toolpath),
    toolProfile: toolProfile(profileTool(machine, tools)),
  };
}

function paneGridSpec(project: Project, machine: CncMachineConfig): RemovalGridSpec {
  const stock = machine.stock;
  const a = toSceneCoords(stock.originOffset, project.device);
  const b = toSceneCoords(
    { x: stock.originOffset.x + stock.widthMm, y: stock.originOffset.y + stock.heightMm },
    project.device,
  );
  const widthMm = Math.abs(b.x - a.x);
  const heightMm = Math.abs(b.y - a.y);
  const mmPerCell = Math.max(
    DEFAULT_CELL_MM,
    Math.max(widthMm, heightMm) / PANE_TARGET_CELLS_PER_AXIS,
  );
  return {
    originX: Math.min(a.x, b.x),
    originY: Math.min(a.y, b.y),
    widthMm,
    heightMm,
    mmPerCell,
  };
}

// The drawn bit silhouette. A single-bit job draws the bit that stamped its
// grid — read from the SAME map the stamping used, so the drawn cutter and
// the simulated one cannot disagree. A multi-bit job has no single honest
// silhouette; the machine's active bit stands in while the GRID stays per-bit.
function profileTool(machine: CncMachineConfig, tools: ReadonlyMap<string, CncTool>): CncTool {
  const sole = tools.size === 1 ? [...tools.values()][0] : undefined;
  return sole ?? activeCncTool(machine);
}
