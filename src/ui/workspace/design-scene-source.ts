// computeDesignSceneSource — the CNC pane's design-time scene source: the
// removal grid AND the 3D moves that carved it, both derived from ONE
// prepareOutput call. The grid is stamped per tool section (H.7 per-layer
// bits), so a v-carve border reads as a v-groove even when the machine's
// active bit is a flat end mill. Display-only (ADR-261 §3): a null source
// shows a hint and gates nothing.

import { isChiploadMaterialKey } from '../../core/cnc';
import { toSceneCoords } from '../../core/devices';
import type { Group } from '../../core/job';
import {
  activeCncTool,
  layerCncTool,
  type CncMachineConfig,
  type CncTool,
  type OutputScope,
  type Project,
} from '../../core/scene';
import { DEFAULT_CELL_MM, toolProfile, type RemovalGridSpec } from '../../core/sim';
import { toolpathMoves3d } from '../../core/toolpath3d';
import { prepareOutput } from '../../io/gcode';
import { buildPreviewToolpathFromPrepared, previewPreparationIssue } from './draw-preview';
import { sectionToolKeys, stampRemovalPerTool } from './stamp-removal-per-tool';
import type { DesignSceneSource } from './use-cnc-3d-scene';

// Coarser than the Preview grid — the pane recomputes on every edit.
const PANE_TARGET_CELLS_PER_AXIS = 500;

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
  const stamped = stampRemovalPerTool({
    project,
    prepared,
    spec: paneGridSpec(project, machine),
    resolveTool: (toolKey) => machineToolForKey(machine, toolKey),
    fullToolpath: toolpath,
  });
  if (stamped.kind !== 'ok') return null;
  const materialKey = machine.stock.materialKey;
  return {
    grid: stamped.grid,
    // materialKey is a plain string on the model, so an unrecognised key from
    // an older project file falls back to the default palette.
    ...(isChiploadMaterialKey(materialKey) ? { materialKey } : {}),
    moves: toolpathMoves3d(toolpath),
    toolProfile: toolProfile(profileTool(machine, prepared.job.groups)),
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

// '' is the "machine's active bit" section key; unknown ids also resolve to
// the active bit, matching the compiler (F-CNC1: unknown tools are dropped).
function machineToolForKey(machine: CncMachineConfig, toolKey: string): CncTool {
  return layerCncTool(machine, toolKey === '' ? {} : { toolId: toolKey });
}

// The drawn bit silhouette. A single-bit job draws the bit that stamped its
// grid, so the drawn cutter and the simulated one cannot disagree. A
// multi-bit job has no single honest silhouette; the machine's active bit
// stands in while the GRID stays per-bit.
function profileTool(machine: CncMachineConfig, groups: ReadonlyArray<Group>): CncTool {
  const keys = sectionToolKeys(groups);
  const sole = keys.length === 1 ? keys[0] : undefined;
  return sole === undefined ? activeCncTool(machine) : machineToolForKey(machine, sole);
}
