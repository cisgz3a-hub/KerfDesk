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
import type { Toolpath, ToolpathStep } from '../../core/job';
import { activeCncTool, type CncMachineConfig } from '../../core/scene';
import type { Vec2 } from '../../core/scene';
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
 * @param jobOriginOffset Physical placement removed from the preview route.
 * @param scrubFraction How much of the program to stamp, 0..1.
 * @returns The removal grid, or null when the stock rect cannot hold one.
 */
export function computeCncRemovalGrid(
  device: DeviceProfile,
  machine: CncMachineConfig,
  toolpath: Toolpath,
  scrubFraction: number,
  jobOriginOffset: Vec2 = { x: 0, y: 0 },
): RemovalGrid | null {
  const tools = toolpathToolsByToolKey(machine, toolpath);
  const spec = framedOnCut(stockGridSpec(device, machine, jobOriginOffset), toolpath, tools);
  const result = computeRemovalGrid(
    toolpath,
    spec,
    kernelForTool(activeCncTool(machine), spec.mmPerCell ?? DEFAULT_CELL_MM),
    {
      uptoLengthMm: toolpath.totalLength * scrubFraction,
      toolsByToolKey: tools,
    },
  );
  return result.kind === 'ok' ? result.grid : null;
}

// Room round the cut beyond the widest bit's radius, as the Inspector's carved
// stock keeps (ADR-487).
const CUT_FRAME_MARGIN_MM = 2;

/**
 * ADR-579: the grid covers the part of the stock the whole job cuts, plus the
 * widest bit and a margin, not the whole sheet. A 60 mm relief on a 400 mm
 * sheet then gets the fine cells it needs instead of the sheet's budget-sized
 * ones, in the 2D shading and in Cut 3D alike. The frame is the whole job's,
 * not the scrubbed part's, so it stays put while playback runs.
 */
export function framedOnCut(
  stock: RemovalGridSpec,
  toolpath: Toolpath,
  tools: ReadonlyMap<string, { readonly diameterMm: number }>,
): RemovalGridSpec {
  const cut = cutExtent(toolpath);
  if (cut === null) return stock;
  let widest = 0;
  for (const tool of tools.values()) widest = Math.max(widest, tool.diameterMm / 2);
  const room = widest + CUT_FRAME_MARGIN_MM;
  const minX = Math.max(stock.originX, cut.minX - room);
  const minY = Math.max(stock.originY, cut.minY - room);
  const maxX = Math.min(stock.originX + stock.widthMm, cut.maxX + room);
  const maxY = Math.min(stock.originY + stock.heightMm, cut.maxY + room);
  if (!(maxX > minX && maxY > minY)) return stock;
  return gridSpec(minX, minY, maxX - minX, maxY - minY);
}

type Extent = { minX: number; minY: number; maxX: number; maxY: number };

// Where the job's cutting moves and plunges go below the stock top.
function cutExtent(toolpath: Toolpath): Extent | null {
  const extent: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (point: Vec2): void => {
    extent.minX = Math.min(extent.minX, point.x);
    extent.minY = Math.min(extent.minY, point.y);
    extent.maxX = Math.max(extent.maxX, point.x);
    extent.maxY = Math.max(extent.maxY, point.y);
  };
  for (const step of toolpath.steps) {
    if (step.kind === 'plunge') {
      if (step.toZ < 0) add(step.at);
    } else if (step.kind === 'cut' && cutsStock(step)) {
      for (const point of step.polyline) add(point);
    }
  }
  return extent.minX <= extent.maxX ? extent : null;
}

function cutsStock(step: Extract<ToolpathStep, { kind: 'cut' }>): boolean {
  if (step.zs !== undefined) return step.zs.some((z) => z < 0);
  // A step without Z (laser, imported) is drawn as cutting wherever it goes.
  return step.z === undefined || Math.min(step.z.from, step.z.to) < 0;
}

function gridSpec(originX: number, originY: number, widthMm: number, heightMm: number) {
  return {
    originX,
    originY,
    widthMm,
    heightMm,
    mmPerCell: Math.max(DEFAULT_CELL_MM, Math.max(widthMm, heightMm) / UI_TARGET_CELLS_PER_AXIS),
    requestedMmPerCell: DEFAULT_CELL_MM,
    resolutionReason: 'interactive-preview-cell-budget',
  } satisfies RemovalGridSpec;
}

function stockGridSpec(
  device: DeviceProfile,
  machine: CncMachineConfig,
  jobOriginOffset: Vec2,
): RemovalGridSpec {
  const stock = machine.stock;
  // The preview route is artwork-relative: map the physical stock into that
  // same frame by removing the resolved output placement from its machine
  // coordinates. This retains artwork registration while making the material
  // removal surface describe where the job will physically land.
  const a = toSceneCoords(
    {
      x: stock.originOffset.x - jobOriginOffset.x,
      y: stock.originOffset.y - jobOriginOffset.y,
    },
    device,
  );
  const b = toSceneCoords(
    {
      x: stock.originOffset.x + stock.widthMm - jobOriginOffset.x,
      y: stock.originOffset.y + stock.heightMm - jobOriginOffset.y,
    },
    device,
  );
  return gridSpec(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
}
