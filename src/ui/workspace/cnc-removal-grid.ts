// computeCncRemovalGrid — the depth-shaded removal grid behind the CNC
// preview overlay (Phase H.2, ADR-098). The preview toolpath is already
// mapped into SCENE space (preview-scene-frame), and the origin transform is
// an isometry, so lengths and Z survive — the grid is therefore computed
// directly in scene space over the scene-mapped stock rect and needs no flip
// handling to draw.
//
// Multi-bit jobs (H.7) are stamped PER STEP: each cut/plunge carries the bit
// that made it, so a v-carve layer reads as a v-groove even when the machine's
// active bit is a flat end mill. The active bit remains the fallback for steps
// that carry none (imported G-code, laser jobs).

import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { Toolpath } from '../../core/job';
import { activeCncTool, type CncMachineConfig } from '../../core/scene';
import {
  computeRemovalGrid,
  DEFAULT_CELL_MM,
  kernelForTool,
  type RemovalGrid,
  type RemovalGridSpec,
} from '../../core/sim';
import { toolpathToolsByToolKey } from './toolpath-tools';

// Keep the UI grid around 1M cells (≈4 MB) so scrub recomputes stay smooth.
const UI_TARGET_CELLS_PER_AXIS = 1000;

/**
 * Simulates the cut the preview toolpath produces, up to a scrub fraction.
 *
 * Takes the device rather than the whole project so the caller's memo can key
 * on the value-stable field it actually depends on (PRF-01).
 *
 * @param device The device profile, for the stock rect's scene mapping.
 * @param machine The project's CNC machine config; supplies stock and bits.
 * @param toolpath The preview toolpath, already in scene frame.
 * @param scrubFraction How much of the program to stamp, 0..1.
 * @returns The removal grid, or null when the stock rect cannot hold one.
 */
export function computeCncRemovalGrid(
  device: DeviceProfile,
  machine: CncMachineConfig,
  toolpath: Toolpath,
  scrubFraction: number,
): RemovalGrid | null {
  const spec = overlayGridSpec(device, machine);
  const result = computeRemovalGrid(
    toolpath,
    spec,
    kernelForTool(activeCncTool(machine), spec.mmPerCell ?? DEFAULT_CELL_MM),
    {
      uptoLengthMm: toolpath.totalLength * scrubFraction,
      toolsByToolKey: toolpathToolsByToolKey(machine, toolpath),
    },
  );
  return result.kind === 'ok' ? result.grid : null;
}

function overlayGridSpec(device: DeviceProfile, machine: CncMachineConfig): RemovalGridSpec {
  const stock = machine.stock;
  const a = toSceneCoords(stock.originOffset, device);
  const b = toSceneCoords(
    { x: stock.originOffset.x + stock.widthMm, y: stock.originOffset.y + stock.heightMm },
    device,
  );
  const widthMm = Math.abs(b.x - a.x);
  const heightMm = Math.abs(b.y - a.y);
  return {
    originX: Math.min(a.x, b.x),
    originY: Math.min(a.y, b.y),
    widthMm,
    heightMm,
    mmPerCell: Math.max(DEFAULT_CELL_MM, Math.max(widthMm, heightMm) / UI_TARGET_CELLS_PER_AXIS),
  };
}
