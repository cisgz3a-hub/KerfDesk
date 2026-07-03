// useCncRemovalGrid — derive the depth-shaded removal grid for the CNC
// preview (Phase H.2, ADR-098). The preview toolpath is already mapped into
// SCENE space (preview-scene-frame), and the origin transform is an isometry,
// so lengths and Z survive — the grid is therefore computed directly in scene
// space over the scene-mapped stock rect and needs no flip handling to draw.
//
// The scrub position quantizes into buckets so dragging the slider reuses
// memoized grids instead of recomputing per pixel of mouse movement.

import { useMemo } from 'react';
import { toSceneCoords } from '../../core/devices';
import type { Toolpath } from '../../core/job';
import { activeCncTool, type Project } from '../../core/scene';
import {
  computeRemovalGrid,
  DEFAULT_CELL_MM,
  kernelForTool,
  type RemovalGrid,
} from '../../core/sim';

const SCRUB_BUCKETS = 120;
// Keep the UI grid around 1M cells (≈4 MB) so scrub recomputes stay smooth.
const UI_TARGET_CELLS_PER_AXIS = 1000;

export function useCncRemovalGrid(
  project: Project,
  previewMode: boolean,
  toolpath: Toolpath | null,
  scrubberT: number,
): RemovalGrid | null {
  const machine = project.machine;
  const cncMachine = machine?.kind === 'cnc' ? machine : null;
  const device = project.device;
  const quantT = Math.ceil(Math.max(0, Math.min(1, scrubberT)) * SCRUB_BUCKETS) / SCRUB_BUCKETS;

  return useMemo(() => {
    if (!previewMode || cncMachine === null || toolpath === null) return null;
    if (toolpath.totalLength <= 0) return null;
    const stock = cncMachine.stock;
    const a = toSceneCoords(stock.originOffset, device);
    const b = toSceneCoords(
      { x: stock.originOffset.x + stock.widthMm, y: stock.originOffset.y + stock.heightMm },
      device,
    );
    const widthMm = Math.abs(b.x - a.x);
    const heightMm = Math.abs(b.y - a.y);
    const mmPerCell = Math.max(
      DEFAULT_CELL_MM,
      Math.max(widthMm, heightMm) / UI_TARGET_CELLS_PER_AXIS,
    );
    const kernel = kernelForTool(activeCncTool(cncMachine), mmPerCell);
    return computeRemovalGrid(
      toolpath,
      {
        originX: Math.min(a.x, b.x),
        originY: Math.min(a.y, b.y),
        widthMm,
        heightMm,
        mmPerCell,
      },
      kernel,
      { uptoLengthMm: toolpath.totalLength * quantT },
    );
  }, [previewMode, cncMachine, device, toolpath, quantT]);
}
