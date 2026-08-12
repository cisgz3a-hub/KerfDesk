// Max-plus heightmap dilation (Phase H.5, ADR-098/ADR-289): the sampled
// tool-center height field. At a grid point, a tool tip may descend to
//   dilated(x, y) = max over kernel offsets of (h(x+dx, y+dy) − dz)
// without cutting below the sampled target values under its discrete kernel
// (dz is the cutting surface's clearance above the tip at that offset —
// core/sim/tool-kernels). Continuous sweep over included target samples remains
// outside this proof; excluded-mask stock separately uses whole-cell and output-
// precision envelopes below. Adding a finishing allowance lifts the whole
// roughing target so H.8's ball-nose pass has material to finish.
//
// Out-of-bounds neighbors are ignored (treated as bottomless), so the field
// never inflates at the heightmap edge.

import type { ToolKernel } from '../sim';
// Deep import: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/cnc-output-precision';
import type { Heightmap } from './heightmap';

export function dilateHeightmapByTool(
  map: Heightmap,
  kernel: ToolKernel,
  allowanceMm: number,
): Float32Array {
  return dilateHeightmap(map, kernel, allowanceMm, false).tipDepth;
}

/**
 * The sampled tip surface plus mask-boundary evidence gathered in the same
 * kernel scan. A marked center is safe as a stationary sample, but an XY chord
 * to or from it could sweep the cutter through excluded stock.
 */
export function dilateHeightmapByToolWithMaskEvidence(
  map: Heightmap,
  kernel: ToolKernel,
  allowanceMm: number,
): {
  readonly tipDepth: Float32Array;
  readonly touchesExcluded: Uint8Array | undefined;
} {
  return dilateHeightmap(map, kernel, allowanceMm, true);
}

function dilateHeightmap(
  map: Heightmap,
  kernel: ToolKernel,
  allowanceMm: number,
  trackMaskBoundary: boolean,
): {
  readonly tipDepth: Float32Array;
  readonly touchesExcluded: Uint8Array | undefined;
} {
  const { widthCells, heightCells, inclusion } = map;
  const out = new Float32Array(widthCells * heightCells);
  const outBits = new Uint32Array(out.buffer);
  const touchesExcluded =
    trackMaskBoundary && inclusion !== undefined
      ? new Uint8Array(widthCells * heightCells)
      : undefined;
  for (let cy = 0; cy < heightCells; cy += 1) {
    for (let cx = 0; cx < widthCells; cx += 1) {
      const center = cy * widthCells + cx;
      if (inclusion?.[center] === 0) continue;
      storeTipDepth(
        out,
        outBits,
        center,
        dilatedCell(map, kernel, cx, cy, allowanceMm, touchesExcluded, center),
        inclusion !== undefined,
      );
    }
  }
  return { tipDepth: out, touchesExcluded };
}

function dilatedCell(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
  allowanceMm: number,
  touchesExcluded: Uint8Array | undefined,
  center: number,
): number {
  let best = excludedMaskConstraint(map, kernel, cx, cy, touchesExcluded, center);
  for (const offset of kernel.offsets) {
    const neighbor = kernelCellIndex(map, cx + offset.dx, cy + offset.dy);
    if (neighbor === null) continue;
    if (map.inclusion?.[neighbor] === 0) continue;
    const targetDepth = map.depth[neighbor] ?? 0;
    const candidate = targetDepth - offset.dz;
    if (candidate > best) best = candidate;
  }
  const safe = best === Number.NEGATIVE_INFINITY ? (map.depth[center] ?? 0) : best;
  // The roughing target never rises above the stock top.
  return Math.min(0, safe + allowanceMm);
}

function excludedMaskConstraint(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
  touchesExcluded: Uint8Array | undefined,
  center: number,
): number {
  if (map.inclusion === undefined) return Number.NEGATIVE_INFINITY;
  let best = Number.NEGATIVE_INFINITY;
  for (const offset of kernel.maskCellOffsets ?? kernel.offsets) {
    const neighbor = kernelCellIndex(map, cx + offset.dx, cy + offset.dy);
    if (neighbor === null || map.inclusion[neighbor] !== 0) continue;
    const candidate = CNC_MASK_EMISSION_Z_CLEARANCE_MM - offset.dz;
    if (candidate > best) best = candidate;
  }
  markExcludedSweep(map, kernel, cx, cy, touchesExcluded, center);
  return best;
}

function markExcludedSweep(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
  touchesExcluded: Uint8Array | undefined,
  center: number,
): void {
  if (touchesExcluded === undefined || map.inclusion === undefined) return;
  for (const offset of kernel.maskSweepCellOffsets ?? kernel.maskCellOffsets ?? kernel.offsets) {
    const neighbor = kernelCellIndex(map, cx + offset.dx, cy + offset.dy);
    if (neighbor === null || map.inclusion[neighbor] !== 0) continue;
    touchesExcluded[center] = 1;
    return;
  }
}

// Masked tip depths must never round to a deeper Float32 value than the proven
// double-precision constraint. Moving one representable step toward stock top
// when necessary preserves the mask proof without changing unmasked output.
function storeTipDepth(
  out: Float32Array,
  outBits: Uint32Array,
  index: number,
  value: number,
  roundTowardStock: boolean,
): void {
  out[index] = value;
  const rounded = out[index] ?? 0;
  if (!roundTowardStock || rounded >= value) return;
  // `value` is capped at zero, so a too-low finite representation is negative.
  // IEEE-754 negative Float32 values move upward when their unsigned bit pattern
  // is decremented by one.
  outBits[index] = (outBits[index] ?? 0) - 1;
}

function kernelCellIndex(map: Heightmap, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= map.widthCells || y >= map.heightCells) return null;
  return y * map.widthCells + x;
}
